$ErrorActionPreference = 'Stop'
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = ConvertFrom-Json $line
    if ($request.close -eq $true) { break }
    $ids = @($request.pids)
    if (!$ids.Count) { throw 'Missing fixture PIDs' }
    foreach ($id in $ids) {
      if (!(($id -is [int]) -or ($id -is [long])) -or $id -le 0 -or $id -gt 2147483647) { throw 'Invalid fixture PID' }
    }
    # Every request obtains fresh CIM evidence. Only the PowerShell host is
    # reused; neither process identities nor exit decisions are cached.
    $filter = ($ids | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR '
    $rows = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop |
      Select-Object ProcessId, ParentProcessId, @{Name='Started';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().Ticks.ToString()}else{$null}}})
    [Console]::WriteLine((ConvertTo-Json -InputObject @{ok=$true;processes=$rows} -Depth 3 -Compress))
  } catch {
    [Console]::Error.WriteLine($_.ToString())
    exit 2
  }
}
