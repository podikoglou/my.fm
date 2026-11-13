import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { ArrowLeft } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { Button, buttonVariants } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormField, FormItem } from "~/components/ui/form";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { UserAvatar } from "~/components/user-avatar";
import { apiClient } from "~/lib/api";
import { queryClient } from "~/lib/query";

const formSchema = z.object({
  isPrivate: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

async function fetchCurrentUser() {
  return parseResponse(apiClient.user.me.$get());
}

type CurrentUser = Awaited<ReturnType<typeof fetchCurrentUser>>;

export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ["user", "me"], queryFn: fetchCurrentUser });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: { isPrivate: data?.isPrivate ?? false },
  });

  const saveSettings = useMutation({
    mutationFn: (values: FormValues) =>
      parseResponse(apiClient.user.settings.$patch({ json: values })),
    onSuccess: (settings) => {
      queryClient.setQueryData<CurrentUser>(["user", "me"], (user) =>
        user ? { ...user, isPrivate: settings.isPrivate } : user,
      );

      form.reset({ isPrivate: settings.isPrivate });
    },
  });

  if (!data) return <></>;

  const onSubmit = (values: FormValues) => {
    saveSettings.mutate(values);
  };

  return (
    <>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-3xl font-bold">Settings</CardTitle>
            <CardDescription className="mt-2">Manage your profile and account.</CardDescription>
          </div>

          <Link
            to={`/user/${data.username}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft />
            Back
          </Link>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-6">
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <UserAvatar
            avatarUrl={data.avatarUrl}
            name={data.name}
            className="h-16 w-16"
            fallbackClassName="text-xl"
          />

          <div className="min-w-0 space-y-1">
            <p className="truncate font-semibold">{data.name}</p>
            <p className="truncate text-sm text-muted-foreground">@{data.username}</p>
            <p className="truncate text-sm text-muted-foreground">{data.email}</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <FormField
              name="isPrivate"
              control={form.control}
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor={field.name}>Private profile</Label>
                    <p id={`${field.name}-description`} className="text-sm text-muted-foreground">
                      Only you can see your profile and your listening history.
                    </p>
                  </div>

                  <Switch
                    id={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-describedby={`${field.name}-description`}
                    disabled={saveSettings.isPending}
                  />
                </FormItem>
              )}
            />

            {saveSettings.isError && (
              <p className="text-sm text-destructive">
                Could not save your settings. Please try again.
              </p>
            )}

            <Button type="submit" disabled={!form.formState.isDirty || saveSettings.isPending}>
              Save
            </Button>
          </form>
        </Form>
      </CardContent>
    </>
  );
}
