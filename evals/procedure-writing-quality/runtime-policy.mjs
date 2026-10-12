/** Keep the existing connection identity, without parent task/session hooks. */
export function childEnvironment(source, bin, memoryHome) {
  const allowed = new Set(['HOME','CODEX_HOME','USER','LOGNAME','LANG','LC_ALL','TZ','TERM','NO_PROXY','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','CURL_CA_BUNDLE','REQUESTS_CA_BUNDLE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS']);
  const environment = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  environment.PATH = `${bin}:/usr/bin:/bin`;
  environment.MEMSPHERE_HOME = memoryHome;
  return environment;
}

/** A full host root bind would expose grading materials regardless of cwd. */
export function namespaceArguments(mounts, workspace) {
  if (mounts.some(([,source,target]) => source === '/' || target === '/')) throw new Error('Host root mounts are forbidden');
  return ['--unshare-user','--unshare-pid','--new-session','--die-with-parent','--tmpfs','/tmp',...mounts.flat(),'--proc','/proc','--dev','/dev','--chdir',workspace];
}
