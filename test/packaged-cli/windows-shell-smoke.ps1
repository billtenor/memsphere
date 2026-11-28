$ErrorActionPreference = 'Stop'

& '.\.ci-install\node_modules\.bin\memsphere.cmd' --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& '.\.ci-install\node_modules\.bin\memsphere.cmd' --help
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location '.ci windows project'
try {
    & '..\.ci-install\node_modules\.bin\memsphere.cmd' view status
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
