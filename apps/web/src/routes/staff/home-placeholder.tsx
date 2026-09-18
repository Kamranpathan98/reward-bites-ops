export function HomePlaceholder(): JSX.Element {
  return (
    <div className="text-muted-foreground">
      The dashboard is not built yet — it arrives in a later gate. Try{' '}
      <a className="underline" href="/app/settings/users">
        Users
      </a>
      .
    </div>
  );
}
