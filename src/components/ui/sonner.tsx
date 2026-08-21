import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;
type ToastVariant = "default" | "destructive" | "success" | "info";
type ToastPayload = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
} & ExternalToast;

const ERROR_TOAST_DURATION = 8000;

const toast = (message: ReactNode | ToastPayload, options?: ExternalToast) => {
  if (typeof message === "object" && message !== null && ("title" in message || "variant" in message)) {
    const { title, description, variant, ...rest } = message as ToastPayload;
    if (variant === "destructive") {
      return sonnerToast.error(title ?? description, { duration: ERROR_TOAST_DURATION, description, ...rest });
    }
    if (variant === "success") {
      return sonnerToast.success(title ?? description, { description, ...rest });
    }
    if (variant === "info") {
      return sonnerToast.info(title ?? description, { description, ...rest });
    }
    return sonnerToast(title ?? description, { description, ...rest });
  }
  return sonnerToast(message as ReactNode, options);
};

toast.success = sonnerToast.success;
toast.error = (message: ReactNode | (() => ReactNode), options?: ExternalToast) =>
  sonnerToast.error(message, { duration: ERROR_TOAST_DURATION, ...options });
toast.info = sonnerToast.info;
toast.warning = sonnerToast.warning;
toast.loading = sonnerToast.loading;
toast.dismiss = sonnerToast.dismiss;
toast.custom = sonnerToast.custom;
toast.promise = sonnerToast.promise;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      duration={5000}
      closeButton
      toastOptions={{
        classNames: {
          closeButton: "!opacity-100",
          toast:
            "group toast min-w-[22rem] px-5 py-4 text-[15px] group-[.toaster]:rounded-sm group-[.toaster]:border-0 group-[.toaster]:bg-ink group-[.toaster]:text-cream group-[.toaster]:shadow-overlay",
          title: "text-[15px] font-semibold leading-5",
          description: "mt-1 text-[14px] leading-5 group-[.toast]:text-neutral-300",
          actionButton: "group-[.toast]:bg-cream group-[.toast]:text-ink",
          cancelButton: "group-[.toast]:bg-neutral-800 group-[.toast]:text-neutral-300",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
