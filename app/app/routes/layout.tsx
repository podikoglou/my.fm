import { Outlet } from "react-router";

import { CardLayout } from "~/components/ui/card-layout";

export default function Layout() {
  return (
    <CardLayout>
      <Outlet />
    </CardLayout>
  );
}
