import { getDefaultStore } from "jotai";
import { useForm } from "react-hook-form";
import { redirect, useNavigate } from "react-router";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { accessTokenAtom } from "~/state/auth";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { authorizeSpotify } from "~/lib/spotify";
import { queryClient } from "~/lib/query";
import { apiClient } from "~/lib/api";
import { parseResponse } from "hono/client";
import { useMutation } from "@tanstack/react-query";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

// NOTE: this loader should be almost identical with the loader in ./app/layout.tsx (just with the opposite logic)
export async function clientLoader() {
  const store = getDefaultStore();

  // ensure we've got an access token
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to spotify to authenticate
  if (!accessToken) {
    authorizeSpotify();
  }

  // ensure we're onboarded
  try {
    const data = await queryClient.fetchQuery({
      queryKey: ["user", "me"],
      queryFn: () => parseResponse(apiClient.user.me.$get()),
    });

    // if already onboarded, redirect to app
    if (data.onboarded) {
      throw redirect("/app");
    }
  } catch (err) {
    // this is what the throw redirect(..) throws. we don't actually want to watch that, so we throw it back
    if (err instanceof Response) {
      throw err;
    }

    console.error(err);
    // if there's an error or no user data, redirect to spotify to re-auth
    authorizeSpotify();
  }
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Please enter at least 1 character." }),
  username: z.string().min(2, { message: "Please enter at least 2 characters." }),
});

type FormValues = z.infer<typeof formSchema>;

export default function OnboardPage() {
  const navigate = useNavigate();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      username: "", // we *couuld* use user.username which is from spotify, but it's gibberish
    },
  });

  const onboard = useMutation({
    mutationFn: (data: FormValues) => parseResponse(apiClient.user.onboard.$put({ form: data })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      navigate("/app");
    },
    onError: (error) => console.error(error),
  });

  const onSubmit = async (data: FormValues) => {
    onboard.mutate(data);
  };

  return (
    <div className="flex w-96 flex-col gap-6">
      <CardHeader className="flex flex-col gap-4 flex-1">
        <div>
          <CardTitle className="text-3xl font-bold">One more thing...</CardTitle>
          <CardDescription className="mt-2">
            We need some more information about you to know you better.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
      </CardContent>
    </div>
  );
}
