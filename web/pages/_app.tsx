import type { AppProps } from "next/app";
import "../src/app/globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import "../src/app/wallet-adapter-overrides.css";
import { Providers } from "../src/app/providers";

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Providers>
      <Component {...pageProps} />
    </Providers>
  );
}