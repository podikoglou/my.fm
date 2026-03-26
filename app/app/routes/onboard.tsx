import { getDefaultStore, useAtom } from "jotai";
import { useForm } from "react-hook-form";
import { redirect, useNavigate } from "react-router";
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
import { userOnboarding } from "~/lib/api";

export async function clientLoader() {
  const store = getDefaultStore();

  // ensure we've got an access token
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to /app and make it handle that
  if (!accessToken) {
    throw redirect("/app");
  }

  // ensure we have a user
  const user = await store.get(userAtom);

  if (!user.data) {
    throw redirect("/app");
  }

  // ensure we're not onboarded
  if (user.data.onboarded) {
    throw redirect("/app");
  }
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Please enter at least 1 character." }),
  username: z.string().min(2, { message: "Please enter at least 2 characters." }),
});

type FormValues = z.infer<typeof formSchema>;

export default function Onboard() {
  const navigate = useNavigate();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      username: "", // we *couuld* use user.username which is from spotify, but it's gibberish
    },
  });

  const onSubmit = async (data: FormValues) => {
    try {
      await userOnboarding({ body: data });
      navigate("/app");
    } catch (e) {
      console.error(e);
    }
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
