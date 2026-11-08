/** The launcher is injected per Attempt. Shell startup can replace PATH, so a
 * bare executable name does not identify this Session's CLI. */
export function reviewerCommand(argumentsText: string): string {
  return `"$MEMSPHERE_CLI" ${argumentsText}`;
}
