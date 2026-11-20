import { useMutation } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { type FormEvent, useRef, useState } from "react";

import { apiClient } from "~/lib/api";
import { queryClient } from "~/lib/query";

export function useImportUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const uploadImport = useMutation({
    mutationFn: (file: File) => parseResponse(apiClient.import.$post({ form: { file } })),
    onSuccess: () => {
      if (inputRef.current) {
        inputRef.current.value = "";
      }

      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["import", "latest"] });
    },
  });

  const handleImportSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (selectedFile) {
      uploadImport.mutate(selectedFile);
    }
  };

  return { inputRef, selectedFile, setSelectedFile, uploadImport, handleImportSubmit };
}
