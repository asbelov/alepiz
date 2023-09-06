param (
    # height of largest column without top bar
    [int]$cnt = 100,
    
    [int]$sleep = 1
)

for ($i=1; $i -le $cnt; $i++)
{
    Write-Host "Iteration number"$i
    Start-Sleep -s $sleep
}