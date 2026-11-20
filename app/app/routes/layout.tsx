import { Outlet } from "react-router";

import { NotificationList } from "~/components/notification-list";
import { CardLayout } from "~/components/ui/card-layout";

export default function Layout() {
  return (
    <CardLayout>
      <NotificationList />
      <Outlet />
    </CardLayout>
  );
}
