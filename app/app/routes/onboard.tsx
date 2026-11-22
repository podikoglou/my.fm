import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { apiClient, runApi } from "~/lib/api";
import { requireAuth } from "~/lib/auth-guard";
import { authReturnPath } from "~/lib/auth-return";
import { queryClient } from "~/lib/query";

export async function clientLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const returnTo = authReturnPath(request.url);
  const { user } = await requireAuth(url.pathname + url.search);

  if (user && user.onboarded) {
    throw redirect(returnTo);
  }

  return { returnTo };
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Please enter at least 1 character." }),
  username: z.string().min(2, { message: "Please enter at least 2 characters." }),
});

type FormValues = z.infer<typeof formSchema>;

export default function OnboardPage() {
  const navigate = useNavigate();
  const { returnTo } = useLoaderData<typeof clientLoader>();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      username: "",
    },
  });

  const onboard = useMutation({
    mutationFn: (data: FormValues) => runApi(apiClient.user.onboard({ payload: data })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      void navigate(returnTo);
    },
    onError: (error) => console.error(error),
  });

  const onSubmit = async (data: FormValues) => {
    onboard.mutate(data);
  };

  return (
    <div className="flex w-full flex-col gap-6 sm:w-96">
      <CardHeader className="flex flex-1 flex-col gap-4">
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
                      aria-invalid={!!form.formState.errors.username}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit">Submit</Button>
          </form>
        </Form>
      </CardContent>
    </div>
  );
}
