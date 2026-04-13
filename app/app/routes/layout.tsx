import { Outlet } from "react-router";
import { Card } from "~/components/ui/card";

export default function Layout() {
  return (
    <div className="container mx-auto py-12 max-w-md">
      <div className="min-h-screen flex p-4">
        <Card className="w-full max-w-lg h-[42rem] m-auto overflow-hidden">
          <Outlet />
        </Card>
      </div>
    </div>
  );
}
