type ToastVariant = "info" | "success" | "warning" | "error";

interface ToastPayload {
  message?: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

export const buildToastMessage = (payload: ToastPayload) => {
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  const parts = [payload.title, payload.description].filter(
    (value) => typeof value === "string" && value.trim(),
  ) as string[];
  return parts.join(" ");
};

export const emitToast = (payload: ToastPayload) => {
  if (typeof window === "undefined") return;
  const message = buildToastMessage(payload);
  if (!message) return;
  window.dispatchEvent(
    new CustomEvent("app-toast", {
      detail: {
        message,
        variant: payload.variant,
        duration: payload.duration,
      },
    }),
  );
};
