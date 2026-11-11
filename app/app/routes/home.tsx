import { Navigate } from "react-router";

export function meta() {
  return [
    { title: "my.fm" },
    { name: "description", content: "Track and analyze your music taste" },
  ];
}

export default function HomePage() {
  return <Navigate to="/app" replace />;
}
