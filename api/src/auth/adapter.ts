import { createAdapterFactory, type CustomAdapter, type Where } from "better-auth/adapters";
import { Effect, Match, Schema } from "effect";
import { SqlClient, Statement } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";

const SqlScalarSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Date,
  Schema.Null,
] as const);

const AdapterValueSchema = Schema.Union([SqlScalarSchema, Schema.Array(SqlScalarSchema)] as const);
const AdapterInputSchema = Schema.Union([AdapterValueSchema, Schema.Undefined] as const);

type AdapterValue = typeof AdapterValueSchema.Type;

type SqlScalar = typeof SqlScalarSchema.Type;

const decodeAdapterValue = Schema.decodeUnknownSync(AdapterValueSchema);
const decodeAdapterInput = Schema.decodeUnknownSync(AdapterInputSchema);

const toEpochScalar = (model: string, field: string, value: SqlScalar): SqlScalar => {
  if (Schema.is(Schema.Date)(value)) {
    return model === "users" && field === "createdAt"
      ? Math.floor(value.getTime() / 1000)
      : value.getTime();
  }

  return value;
};

const toEpoch = (model: string, field: string, value: AdapterValue): AdapterValue => {
  if (Schema.is(Schema.Array(SqlScalarSchema))(value)) {
    return value.map((item) => toEpochScalar(model, field, item));
  }

  return toEpochScalar(model, field, value);
};

const toBooleanInt = (value: AdapterValue): AdapterValue => {
  if (Schema.is(Schema.Boolean)(value)) return Number(value);

  if (Schema.is(Schema.Array(SqlScalarSchema))(value)) {
    return value.map((item) => (Schema.is(Schema.Boolean)(item) ? Number(item) : item));
  }

  return value;
};

const toDate = (model: string, field: string, value: number) =>
  new Date(model === "users" && field === "createdAt" ? value * 1000 : value);

const toBoolean = (value: number) => value === 1;

type FindOneInput = Parameters<CustomAdapter["findOne"]>[0];

type FindManyInput = Parameters<CustomAdapter["findMany"]>[0];

type UpdateInput = Parameters<CustomAdapter["update"]>[0];

type UpdateManyInput = Parameters<CustomAdapter["updateMany"]>[0];

type DeleteInput = Parameters<CustomAdapter["delete"]>[0];

type DeleteManyInput = Parameters<CustomAdapter["deleteMany"]>[0];

type ConsumeOneInput = Parameters<NonNullable<CustomAdapter["consumeOne"]>>[0];

type IncrementOneInput = Parameters<NonNullable<CustomAdapter["incrementOne"]>>[0];

const run = <A>(
  client: SqlClient.SqlClient,
  effect: Effect.Effect<A, SqlError, SqlClient.SqlClient>,
) => Effect.runPromise(Effect.provideService(effect, SqlClient.SqlClient, client));

function whereClause(sql: SqlClient.SqlClient, where: Where[], model: string) {
  const conditions = where.map(({ field, value, operator = "eq", mode = "sensitive" }) => {
    const column = sql(field);
    const encodedValue = toBooleanInt(toEpoch(model, field, decodeAdapterValue(value)));

    switch (operator) {
      case "eq":
        return encodedValue === null
          ? Statement.fragment([column, Statement.literal(" IS NULL")])
          : Statement.fragment([
              column,
              Statement.literal(" = "),
              Statement.parameter(encodedValue),
            ]);
      case "ne":
        return encodedValue === null
          ? Statement.fragment([column, Statement.literal(" IS NOT NULL")])
          : Statement.fragment([
              column,
              Statement.literal(" != "),
              Statement.parameter(encodedValue),
            ]);
      case "lt":
        return Statement.fragment([
          column,
          Statement.literal(" < "),
          Statement.parameter(encodedValue),
        ]);
      case "lte":
        return Statement.fragment([
          column,
          Statement.literal(" <= "),
          Statement.parameter(encodedValue),
        ]);
      case "gt":
        return Statement.fragment([
          column,
          Statement.literal(" > "),
          Statement.parameter(encodedValue),
        ]);
      case "gte":
        return Statement.fragment([
          column,
          Statement.literal(" >= "),
          Statement.parameter(encodedValue),
        ]);
      case "in":
      case "not_in": {
        const values = Schema.decodeUnknownSync(Schema.Array(SqlScalarSchema))(encodedValue);

        if (values.length === 0) {
          return Match.value(operator).pipe(
            Match.when("in", () => Statement.fragment([Statement.literal("0 = 1")])),
            Match.orElse(() => Statement.fragment([Statement.literal("1 = 1")])),
          );
        }

        const membership = sql.in(values);

        return Match.value(operator).pipe(
          Match.when("in", () =>
            Statement.fragment([column, Statement.literal(" IN "), membership]),
          ),
          Match.orElse(() =>
            Statement.fragment([column, Statement.literal(" NOT IN "), membership]),
          ),
        );
      }

      case "contains":
      case "starts_with":
      case "ends_with": {
        const term = Schema.decodeUnknownSync(Schema.String)(value);

        const pattern = Match.value(operator).pipe(
          Match.when("contains", () => `%${term}%`),
          Match.when("starts_with", () => `${term}%`),
          Match.orElse(() => `%${term}`),
        );

        if (mode === "insensitive") {
          return Statement.fragment([
            Statement.literal("LOWER("),
            column,
            Statement.literal(") LIKE LOWER("),
            Statement.parameter(pattern),
            Statement.literal(")"),
          ]);
        }

        return Statement.fragment([
          column,
          Statement.literal(" LIKE "),
          Statement.parameter(pattern),
        ]);
      }

      default:
        throw new Error(`Unsupported Better Auth where operator: ${operator}`);
    }
  });

  if (conditions.length === 0) return Statement.fragment([Statement.literal("1 = 1")]);

  const groups: Array<ReturnType<typeof sql.and>> = [];
  let andGroup: typeof conditions = [];

  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];

    if (condition === undefined) continue;

    if (index > 0 && where[index]?.connector === "OR") {
      groups.push(sql.and(andGroup));
      andGroup = [condition];
    } else {
      andGroup.push(condition);
    }
  }

  groups.push(sql.and(andGroup));

  if (groups.length === 1) {
    return groups[0] ?? sql`1 = 1`;
  }

  return sql.or(groups);
}

export const effectSqlAdapter = (client: SqlClient.SqlClient) =>
  createAdapterFactory({
    config: {
      adapterId: "effect-sql",
      adapterName: "Effect SQL",
      transaction: false,
      supportsDates: true,
      supportsBooleans: true,
      supportsJSON: false,
      customTransformInput: ({ data, fieldAttributes, field, model }) => {
        if (fieldAttributes.type === "date") {
          const date = Schema.decodeUnknownSync(Schema.NullOr(Schema.Date))(data);

          return date === null ? null : toEpoch(model, field, date);
        }

        if (fieldAttributes.type === "boolean") {
          const boolean = Schema.decodeUnknownSync(Schema.NullOr(Schema.Boolean))(data);

          return boolean === null ? null : toBooleanInt(boolean);
        }

        return decodeAdapterInput(data);
      },
      customTransformOutput: ({ data, fieldAttributes, field, model }) => {
        if (fieldAttributes.type === "date") {
          const timestamp = Schema.decodeUnknownSync(Schema.NullOr(Schema.Int))(data);

          return timestamp === null
            ? null
            : toDate(model, fieldAttributes.fieldName ?? field, timestamp);
        }

        if (fieldAttributes.type === "boolean") {
          const integer = Schema.decodeUnknownSync(Schema.NullOr(Schema.Int))(data);

          return integer === null ? null : toBoolean(integer);
        }

        return decodeAdapterInput(data);
      },
    },
    adapter: ({ getDefaultModelName, getFieldName }) => {
      const selected = (modelKey: string, select?: string[]) =>
        select?.length
          ? select.map((field) => client`${client(getFieldName({ model: modelKey, field }))}`)
          : [client`*`];

      const defaultModelKey = (model: string, modelKey?: string) =>
        modelKey ?? getDefaultModelName(model);

      const adapter: CustomAdapter = {
        create: async ({ data, model }) => {
          const rows = await run(
            client,
            client<typeof data>`
              INSERT INTO ${client(model)} ${client.insert(data)}
              RETURNING *
            `,
          );

          const [created] = rows;

          if (created === undefined) {
            throw new Error("Better Auth create query returned no row");
          }

          return created;
        },
        findOne: async <T>(args: FindOneInput): Promise<T | null> => {
          const { model, modelKey, where, select } = args;

          const rows = await run(
            client,
            client<T & object>`
              SELECT ${client.csv(selected(defaultModelKey(model, modelKey), select))}
              FROM ${client(model)}
              WHERE ${whereClause(client, where, model)}
              LIMIT 1
            `,
          );

          return rows[0] ?? null;
        },
        findMany: async <T>(args: FindManyInput): Promise<T[]> => {
          const { model, modelKey, where = [], limit, select, sortBy, offset } = args;
          const modelKeyResolved = defaultModelKey(model, modelKey);

          const order = Match.value(sortBy).pipe(
            Match.when(undefined, () => client``),
            Match.when(
              { direction: "desc" },
              ({ field }) =>
                client`ORDER BY ${client(getFieldName({ model: modelKeyResolved, field }))} DESC`,
            ),
            Match.orElse(
              ({ field }) =>
                client`ORDER BY ${client(getFieldName({ model: modelKeyResolved, field }))} ASC`,
            ),
          );

          let limitClause = client``;

          if (limit !== undefined) {
            limitClause = client`LIMIT ${limit}`;
          } else if (offset !== undefined) {
            limitClause = client`LIMIT -1`;
          }

          const rows = await run(
            client,
            client<T & object>`
              SELECT ${client.csv(selected(modelKeyResolved, select))}
              FROM ${client(model)}
              WHERE ${whereClause(client, where, model)}
              ${order}
              ${limitClause}
              ${offset === undefined ? client`` : client`OFFSET ${offset}`}
            `,
          );

          return [...rows];
        },
        count: async ({ model, where = [] }) => {
          const rows = await run(
            client,
            client<{ count: number }>`
              SELECT COUNT(*) AS count
              FROM ${client(model)}
              WHERE ${whereClause(client, where, model)}
            `,
          );

          return Number(rows[0]?.count ?? 0);
        },
        update: async <T>(args: UpdateInput): Promise<T | null> => {
          const { model, where, update } = args;

          if (where.length === 0) return null;

          const updateValues = Schema.decodeUnknownSync(
            Schema.Record(Schema.String, AdapterValueSchema),
          )(update);

          const rows = await run(
            client,
            client<T & object>`
              UPDATE ${client(model)} SET ${client.update(updateValues)}
              WHERE ${whereClause(client, where, model)}
              RETURNING *
            `,
          );

          return rows[0] ?? null;
        },
        updateMany: async (args: UpdateManyInput) => {
          const { model, where, update } = args;

          const updateValues = Schema.decodeUnknownSync(
            Schema.Record(Schema.String, AdapterValueSchema),
          )(update);

          const rows = await run(
            client,
            client<{ affected: number }>`
              UPDATE ${client(model)} SET ${client.update(updateValues)}
              WHERE ${whereClause(client, where, model)}
              RETURNING 1 AS affected
            `,
          );

          return rows.length;
        },
        delete: async (args: DeleteInput) => {
          const { model, where } = args;

          if (where.length === 0) return;

          await run(
            client,
            client`
              DELETE FROM ${client(model)}
              WHERE ${whereClause(client, where, model)}
            `,
          );
        },
        deleteMany: async (args: DeleteManyInput) => {
          const { model, where } = args;

          const rows = await run(
            client,
            client<{ affected: number }>`
              DELETE FROM ${client(model)}
              WHERE ${whereClause(client, where, model)}
              RETURNING 1 AS affected
            `,
          );

          return rows.length;
        },
        consumeOne: async <T>(args: ConsumeOneInput): Promise<T | null> => {
          const { model, where } = args;

          const rows = await run(
            client,
            client<T & object>`
              DELETE FROM ${client(model)}
              WHERE id = (
                SELECT id FROM ${client(model)}
                WHERE ${whereClause(client, where, model)}
                LIMIT 1
              )
              RETURNING *
            `,
          );

          return rows[0] ?? null;
        },
        incrementOne: async <T>(args: IncrementOneInput): Promise<T | null> => {
          const { model, where, increment, set } = args;

          const setValues = Schema.decodeUnknownSync(
            Schema.Record(Schema.String, AdapterValueSchema),
          )(set ?? {});

          const incrementValues = Schema.decodeUnknownSync(
            Schema.Record(Schema.String, Schema.Finite),
          )(increment);

          const updates = [
            ...Object.entries(setValues).map(
              ([field, value]) => client`${client(field)} = ${value}`,
            ),
            ...Object.entries(incrementValues).map(
              ([field, value]) => client`${client(field)} = ${client(field)} + ${value}`,
            ),
          ];

          if (updates.length === 0 || where.length === 0) return null;

          const rows = await run(
            client,
            client<T & object>`
              UPDATE ${client(model)}
              SET ${client.join(", ")(updates)}
              WHERE id = (
                SELECT id FROM ${client(model)}
                WHERE ${whereClause(client, where, model)}
                LIMIT 1
              )
              RETURNING *
            `,
          );

          return rows[0] ?? null;
        },
      };

      return adapter;
    },
  });
