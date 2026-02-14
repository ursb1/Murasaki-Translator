type ToastVariant = "info" | "success" | "warning" | "error";

interface ToastPayload {
  message: string;
  variant?: ToastVariant;
  duration?: number;
}

export const emitToast = (payload: ToastPayload) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app-toast", { detail: payload }));
};
