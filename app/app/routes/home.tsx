import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "my.fm" },
    { name: "description", content: "Track and analyze your music taste" },
  ];
}

export function clientLoader({ params }: Route.ClientLoaderArgs) {}

export default function IndexPage() {
  return <></>;
}
