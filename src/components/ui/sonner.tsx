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

const toast = (message: ReactNode | ToastPayload, options?: ExternalToast) => {
  if (typeof message === "object" && message !== null && ("title" in message || "variant" in message)) {
    const { title, description, variant, ...rest } = message as ToastPayload;
    if (variant === "destructive") {
      return sonnerToast.error(title ?? description, { description, ...rest });
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
toast.error = sonnerToast.error;
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
      duration={7000}
      toastOptions={{
        classNames: {
          toast:
            "group toast min-w-[22rem] px-5 py-4 text-[15px] group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          title: "text-[15px] font-semibold leading-5",
          description: "mt-1 text-[14px] leading-5 group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
