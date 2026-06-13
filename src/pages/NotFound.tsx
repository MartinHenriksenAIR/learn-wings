import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

// Match Login's soft slate canvas + centered card chrome.
const PAGE_GRADIENT_CLASSES = "bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]";

const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[20px] border border-border bg-card px-10 py-11 text-center shadow-[0_24px_60px_rgba(16,41,143,0.10)]">
        <span className="font-display text-[64px] font-extrabold leading-none tracking-tight text-primary">404</span>
        <h1 className="text-[17px] font-bold text-foreground">{t("notFound.title")}</h1>
        <p className="text-balance text-sm leading-[1.55] text-muted-foreground">
          {t("notFound.description")}
        </p>
        <Link to="/">
          <Button size="sm">{t("notFound.returnHome")}</Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
