import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { Button, buttonVariants } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormField, FormItem } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { UserAvatar } from "~/components/user-avatar";
import { apiClient } from "~/lib/api";
import { queryClient } from "~/lib/query";
import { cn } from "~/lib/utils";

const formSchema = z.object({
  isPrivate: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const errorResponseSchema = z.object({
  error: z.string().optional(),
});

async function fetchCurrentUser() {
  return parseResponse(apiClient.user.me.$get());
}

type CurrentUser = Awaited<ReturnType<typeof fetchCurrentUser>>;

async function fetchLatestImport() {
  return parseResponse(apiClient.import.latest.$get());
}

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

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);

  const { data: latestImportData, refetch: refetchLatestImport } = useQuery({
    queryKey: ["import", "latest"],
    queryFn: fetchLatestImport,
  });

  const latestImport = latestImportData?.import;

  const handleImportSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!selectedFile) {
      return;
    }

    setIsUploading(true);
    setUploadMessage(null);
    setUploadError(false);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const rawJson: unknown = await res.json().catch(() => ({}));
        const parsed = errorResponseSchema.safeParse(rawJson);
        const errorText = parsed.success ? parsed.data.error : undefined;

        setUploadError(true);
        setUploadMessage(errorText ?? "Import failed. Please try again.");
      } else {
        setUploadError(false);
        setUploadMessage("File accepted. Ingestion will process in the background.");
        setSelectedFile(null);
        await refetchLatestImport();
      }
    } catch {
      setUploadError(true);
      setUploadMessage("Network error during upload.");
    } finally {
      setIsUploading(false);
    }
  };

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

        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="history-file">Import listening history</Label>
            <p className="text-sm text-muted-foreground">
              Upload a listening history CSV export (up to 10 MB).
            </p>
          </div>

          <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
            <Input
              id="history-file"
              type="file"
              accept=".csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              disabled={isUploading}
            />

            {latestImport && (
              <p className="text-xs text-muted-foreground">
                Status: {latestImport.status}
                {latestImport.processedRows > 0 &&
                  ` (${latestImport.processedRows} plays processed)`}
              </p>
            )}

            {uploadMessage && (
              <p
                className={cn(
                  "text-sm",
                  uploadError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {uploadMessage}
              </p>
            )}

            <Button type="submit" disabled={!selectedFile || isUploading} className="self-start">
              {isUploading ? "Uploading..." : "Import"}
            </Button>
          </form>
        </div>
      </CardContent>
    </>
  );
}
