export function createContainerDatabaseUrl(
  user: string,
  database: string,
  passwordFileContents: string,
) {
  if (!user || !database) {
    throw new Error("Set POSTGRES_USER and POSTGRES_DB for the container.");
  }
  // Accept one newline from password-file preparation, preserving spaces.
  const password = passwordFileContents.replace(/\r?\n$/, "");
  if (!password || /[\r\n\0]/.test(password)) {
    throw new Error("The database password file must contain one non-empty line.");
  }
  return (
    "postgresql://" +
    encodeURIComponent(user) +
    ":" +
    encodeURIComponent(password) +
    "@db:5432/" +
    encodeURIComponent(database)
  );
}
