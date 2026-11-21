export function authReturnPath(requestUrl: string) {
  const url = new URL(requestUrl);
  const returnTo = url.searchParams.get("returnTo");

  if (!returnTo?.startsWith("/") || returnTo.startsWith("//")) return "/";

  const target = new URL(returnTo, url.origin);

  return target.origin === url.origin ? target.pathname + target.search : "/";
}

export function onboardingPath(returnTo: string) {
  return "/onboard?" + new URLSearchParams({ returnTo });
}
