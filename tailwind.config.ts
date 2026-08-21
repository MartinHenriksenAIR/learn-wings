import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        display: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Learner-dashboard accents (#455, "Nordic"). Deliberately outside the
        // app's token set: on that surface colour carries identity — which
        // course, which rank — as a full fill, never the navy tint used
        // elsewhere. Do not reach for these outside the dashboard.
        dash: {
          ink: "#141a33",
          a1: "#a5b4fc",
          a2: "#f7d9a8",
          a3: "#a7e8c4",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        canvas: "var(--canvas)",
        surface: {
          DEFAULT: "var(--surface)",
          sunken: "var(--surface-sunken)",
          ink: "var(--surface-ink)",
        },
        ink: "var(--ink)",
        cream: "var(--cream)",
        interactive: {
          DEFAULT: "var(--interactive)",
          hover: "var(--interactive-hover)",
          tint: "var(--interactive-tint)",
          "tint-hover": "var(--interactive-tint-hover)",
        },
        focus: "var(--focus)",
        navy: {
          50: "var(--navy-50)",
          100: "var(--navy-100)",
          200: "var(--navy-200)",
          300: "var(--navy-300)",
          400: "var(--navy-400)",
          500: "var(--navy-500)",
          600: "var(--navy-600)",
          700: "var(--navy-700)",
          800: "var(--navy-800)",
          900: "var(--navy-900)",
        },
        neutral: {
          0: "var(--neutral-0)",
          50: "var(--neutral-50)",
          100: "var(--neutral-100)",
          150: "var(--neutral-150)",
          200: "var(--neutral-200)",
          300: "var(--neutral-300)",
          400: "var(--neutral-400)",
          500: "var(--neutral-500)",
          600: "var(--neutral-600)",
          700: "var(--neutral-700)",
          800: "var(--neutral-800)",
          900: "var(--neutral-900)",
        },
        green: {
          ...defaultColors.green,
          tint: "var(--green-tint)",
          pastel: "var(--green-pastel)",
          DEFAULT: "var(--green-base)",
          deep: "var(--green-deep)",
        },
        amber: {
          ...defaultColors.amber,
          tint: "var(--amber-tint)",
          pastel: "var(--amber-pastel)",
          DEFAULT: "var(--amber-base)",
          deep: "var(--amber-deep)",
        },
        red: {
          ...defaultColors.red,
          tint: "var(--red-tint)",
          DEFAULT: "var(--red-base)",
          deep: "var(--red-deep)",
        },
        peri: {
          tint: "var(--peri-tint)",
          pastel: "var(--peri-pastel)",
          deep: "var(--peri-deep)",
        },
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        overlay: "var(--shadow-overlay)",
        float: "var(--shadow-float)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        exit: "var(--ease-exit)",
        celebrate: "var(--ease-celebrate)",
      },
      fontSize: {
        display: ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.022em", fontWeight: "800" }],
        heading: ["1.375rem", { lineHeight: "1.25" }],
        subheading: ["1.0625rem", { lineHeight: "1.35" }],
        "body-reading": ["0.9375rem", { lineHeight: "1.7" }],
        "title-ui": ["1rem", { lineHeight: "1.3" }],
        "body-ui": ["0.875rem", { lineHeight: "1.5" }],
        label: "0.78125rem",
        caption: ["0.75rem", { lineHeight: "1.45" }],
        micro: "0.6875rem",
        code: "0.78125rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pop-in": {
          "0%": { transform: "scale(0.3)" },
          "60%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        "bulb-wiggle": {
          "0%, 100%": { transform: "rotate(0) scale(1)" },
          "30%": { transform: "rotate(-12deg) scale(1.12)" },
          "65%": { transform: "rotate(9deg) scale(1.06)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "0% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down var(--motion-base) var(--ease-standard)",
        "accordion-up": "accordion-up var(--motion-base) var(--ease-standard)",
        "pop-in": "pop-in 0.35s ease",
        "bulb-wiggle": "bulb-wiggle 0.55s ease",
        shimmer: "shimmer 1.5s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
