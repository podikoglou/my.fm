import { Outlet } from "react-router";

export default function Layout() {
  return (
    <div className="container mx-auto py-12 max-w-md">
      <Outlet />
    </div>
  );
}
