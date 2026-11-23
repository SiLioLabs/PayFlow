/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: "src/**/*.stories.tsx",
  outDir: "ladle-build",
  port: 61000,
  base: "/",
  viteConfig: "../vite.config.ts",
  storyOrder: [
    "Skeleton*",
    "Toast*",
    "SubscriptionCard*",
    "SubscribeForm*",
    "PayPerUseForm*",
    "ConnectWallet*",
    "NetworkBadge*",
    "CopyButton*",
    "ContractPauseBanner*",
    "Spinner*",
  ],
};
