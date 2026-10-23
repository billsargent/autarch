import { Nunito, Pixelify_Sans } from "next/font/google";

// The village's fonts (SIL Open Font License). Apply `villageFonts` to a root
// element; the CSS uses the --font-pixel and --font-body variables.
const pixelFont = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel" });
const bodyFont = Nunito({ subsets: ["latin"], variable: "--font-body" });

export const villageFonts = `${pixelFont.variable} ${bodyFont.variable}`;
