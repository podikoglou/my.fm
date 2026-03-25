import { getDefaultStore, useAtom } from "jotai";
import { useForm } from "react-hook-form";
import { redirect } from "react-router";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { accessTokenAtom } from "~/state/auth";
import { userAtom } from "~/state/user";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

export async function clientLoader() {
  const store = getDefaultStore();

  // ensure we've got an access token
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to /app and make it handle that
  if (!accessToken) {
    throw redirect("/app");
  }

  // ensure we're not onboarded
  const user = await store.get(userAtom);

  if (user.onboarded) {
    throw redirect("/app");
  }
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Please enter at least 1 character." }),
  username: z.string().min(2, { message: "Please enter at least 2 characters." }),
});

type FormValues = z.infer<typeof formSchema>;

export default function Onboard() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      username: "", // we *couuld* use user.username which is from spotify, but it's gibberish
    },
  });

  const onSubmit = (data: FormValues) => {
    console.log(data);
  };

  return (
    <div className="flex w-96 flex-col gap-6">
      <div>
        <h1 className="text-4xl font-extrabold">One more thing...</h1>
        <p>We need some more information about you to know you better.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex w-96 flex-col gap-4">
          <FormField
            name="..."
            render={() => (
              <FormField
                name="name"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        className="w-full"
                        placeholder="kyle"
                        aria-invalid={!!form.formState.errors.name}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      This is the name that will be displayed to other users.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          />

          <FormField
            name="..."
            render={() => (
              <FormField
                name="username"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        className="w-full"
                        placeholder="kyles"
                        aria-invalid={!!form.formState.errors.name}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>This is a unique name that identifies you.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          />

          <Button type="submit">Submit</Button>
        </form>
      </Form>
    </div>
  );
}
