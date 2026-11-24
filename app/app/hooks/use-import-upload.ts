import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useRef } from "react";

import { runApi, uploadImportFile } from "~/lib/api";
import { queryClient } from "~/lib/query";

export function useImportUpload() {
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadImport = useMutation({
    mutationFn: (file: File) => runApi(uploadImportFile(file)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["import", "latest"] });
    },
    onSettled: () => {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
  });

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file && !uploadImport.isPending) {
      uploadImport.mutate(file);
    }
  };

  const openFilePicker = () => inputRef.current?.click();

  return { inputRef, uploadImport, handleFileChange, openFilePicker };
}
