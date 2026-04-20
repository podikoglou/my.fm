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
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { queryClient } from "~/lib/query";
import { apiClient } from "~/lib/api";
import { parseResponse } from "hono/client";
import { useMutation } from "@tanstack/react-query";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireAuth } from "~/lib/auth-guard";

export async function clientLoader() {
  const { user } = await requireAuth("/onboard");

  if (user && user.onboarded) {
    throw redirect("/app");
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
      username: "",
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
