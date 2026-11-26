import { Outlet } from "react-router";

import { AppBar } from "~/components/app-bar";

export default function AppBarLayout() {
  return (
    <>
      <AppBar />
      <Outlet />
    </>
  );
}
