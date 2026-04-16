/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Solve.AI dark theme
        agro: {
          bg:        "#0a110e",
          "bg-2":    "#0f1a13",
          "bg-3":    "#132118",
          surface:   "#1a2e22",
          "surface-2": "#1f3828",
          border:    "#253d2e",
          "border-2":"#2e4d38",
          green:     "#3fb06c",
          "green-2": "#2d8f53",
          "green-3": "#16A34A",
          "green-glow": "rgba(63,176,108,0.35)",
          "green-subtle": "rgba(63,176,108,0.08)",
          "green-subtle-2": "rgba(63,176,108,0.14)",
          muted:     "#8faf9a",
          "muted-2": "#6b8f77",
          text:      "#e8f0ea",
          "text-2":  "#b8ccbd",
          "text-3":  "#8faf9a",
          amber:     "#d97706",
          red:       "#ef4444",
          blue:      "#3b82f6",
        },
        primary: {
          DEFAULT: "#3fb06c",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "#EF4444",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans:    ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "green-glow":    "0 0 20px rgba(63,176,108,0.35), 0 0 60px rgba(63,176,108,0.12)",
        "green-glow-sm": "0 0 10px rgba(63,176,108,0.3)",
        "green-glow-lg": "0 0 40px rgba(63,176,108,0.4), 0 0 80px rgba(63,176,108,0.15)",
        "dark-card":     "0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)",
        "dark-card-lg":  "0 20px 60px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.4)",
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
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(63,176,108,0.3), 0 0 20px rgba(63,176,108,0.1)" },
          "50%":       { boxShadow: "0 0 16px rgba(63,176,108,0.5), 0 0 40px rgba(63,176,108,0.2)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "connector-fill": {
          from: { width: "0%" },
          to:   { width: "100%" },
        },
        "slide-right": {
          from: { transform: "translateX(-4px)", opacity: "0.5" },
          to:   { transform: "translateX(0)",  opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to:   { transform: "scale(1)",    opacity: "1" },
        },
      },
      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "glow-pulse":      "glow-pulse 2.5s ease-in-out infinite",
        "fade-up":         "fade-up 0.4s ease-out both",
        "fade-up-delay-1": "fade-up 0.4s 0.1s ease-out both",
        "fade-up-delay-2": "fade-up 0.4s 0.2s ease-out both",
        "fade-up-delay-3": "fade-up 0.4s 0.3s ease-out both",
        "fade-up-delay-4": "fade-up 0.4s 0.4s ease-out both",
        "fade-in":         "fade-in 0.3s ease-out both",
        "scale-in":        "scale-in 0.3s ease-out both",
      },
      backgroundImage: {
        "green-gradient":  "linear-gradient(135deg, #3fb06c 0%, #16A34A 100%)",
        "dark-gradient":   "linear-gradient(135deg, #1a2e22 0%, #0f1a13 100%)",
        "glow-radial":     "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(63,176,108,0.08) 0%, transparent 70%)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
