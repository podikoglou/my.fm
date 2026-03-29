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
import {
  putUserProfileMutation,
  getUserOptions,
  getUserQueryKey,
} from "~/lib/api/@tanstack/react-query.gen";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
      ...getUserOptions({}),
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
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      username: "", // we *couuld* use user.username which is from spotify, but it's gibberish
    },
  });

  const putUserProfile = useMutation({
    ...putUserProfileMutation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getUserQueryKey() });
      navigate("/app");
    },
    onError: (error) => console.error(error),
  });

  const onSubmit = async (data: FormValues) => {
    putUserProfile.mutate({
      body: data,
    });
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
