"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanWindowsPath = scanWindowsPath;
exports.killWindowsProcesses = killWindowsProcesses;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_util_1 = require("node:util");
const process_1 = require("../../core/process");
const scanner_1 = require("../../core/scanner");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const log = {
    error(message, error) {
        console.error(message, error);
    },
};
const restartManagerScript = String.raw `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$targetPath = $env:FILE_UNLOCKER_TARGET
$recursive = $env:FILE_UNLOCKER_RECURSIVE -ne 'false'

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class RestartManagerNative
{
    private const int CCH_RM_MAX_APP_NAME = 255;
    private const int CCH_RM_MAX_SVC_NAME = 63;

    public enum RM_APP_TYPE
    {
        RmUnknownApp = 0,
        RmMainWindow = 1,
        RmOtherWindow = 2,
        RmService = 3,
        RmExplorer = 4,
        RmConsole = 5,
        RmCritical = 1000
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS
    {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
        public string strServiceShortName;
        public RM_APP_TYPE ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmRegisterResources(uint pSessionHandle, UInt32 nFiles, string[] rgsFilenames, UInt32 nApplications, IntPtr rgApplications, UInt32 nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    [DllImport("rstrtmgr.dll")]
    public static extern int RmEndSession(uint pSessionHandle);
}


public static class ProcessDirectoryNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, ref PROCESS_BASIC_INFORMATION processInformation, int processInformationLength, out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int processAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr processHandle, IntPtr baseAddress, byte[] buffer, int size, out IntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    public static string GetCurrentDirectory(int processId)
    {
        const int PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        const int PROCESS_VM_READ = 0x0010;
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, processId);
        if (handle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();
            int returnLength = 0;
            int status = NtQueryInformationProcess(handle, 0, ref pbi, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returnLength);
            if (status != 0 || pbi.PebBaseAddress == IntPtr.Zero)
            {
                return null;
            }

            bool is64Bit = IntPtr.Size == 8;
            IntPtr processParametersAddress = ReadPointer(handle, IntPtr.Add(pbi.PebBaseAddress, is64Bit ? 0x20 : 0x10), is64Bit);
            if (processParametersAddress == IntPtr.Zero)
            {
                return null;
            }

            IntPtr currentDirectoryAddress = IntPtr.Add(processParametersAddress, is64Bit ? 0x38 : 0x24);
            byte[] unicodeString = ReadBytes(handle, currentDirectoryAddress, is64Bit ? 16 : 8);
            if (unicodeString == null)
            {
                return null;
            }

            ushort length = BitConverter.ToUInt16(unicodeString, 0);
            if (length == 0 || length > 32766)
            {
                return null;
            }

            IntPtr bufferAddress = is64Bit
                ? new IntPtr(BitConverter.ToInt64(unicodeString, 8))
                : new IntPtr(BitConverter.ToInt32(unicodeString, 4));
            if (bufferAddress == IntPtr.Zero)
            {
                return null;
            }

            byte[] pathBytes = ReadBytes(handle, bufferAddress, length);
            return pathBytes == null ? null : Encoding.Unicode.GetString(pathBytes);
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static IntPtr ReadPointer(IntPtr handle, IntPtr address, bool is64Bit)
    {
        byte[] bytes = ReadBytes(handle, address, is64Bit ? 8 : 4);
        if (bytes == null)
        {
            return IntPtr.Zero;
        }

        return is64Bit ? new IntPtr(BitConverter.ToInt64(bytes, 0)) : new IntPtr(BitConverter.ToInt32(bytes, 0));
    }

    private static byte[] ReadBytes(IntPtr handle, IntPtr address, int length)
    {
        byte[] buffer = new byte[length];
        IntPtr bytesRead;
        if (!ReadProcessMemory(handle, address, buffer, length, out bytesRead) || bytesRead.ToInt64() != length)
        {
            return null;
        }

        return buffer;
    }
}
"@

function Resolve-RegisterFiles([string] $path) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        return @((Resolve-Path -LiteralPath $path).ProviderPath)
    }

    if (Test-Path -LiteralPath $path -PathType Container) {
        $childItemParams = @{
            LiteralPath = $path
            File = $true
            Force = $true
            ErrorAction = 'SilentlyContinue'
        }
        if ($recursive) {
            $childItemParams.Recurse = $true
        }
        $maxRegisterFiles = 2048
        $priorityExtensions = @('.exe', '.dll', '.node', '.ps1', '.cmd', '.bat', '.js', '.cjs', '.mjs', '.json')
        $allFiles = @(Get-ChildItem @childItemParams)
        $priorityFiles = @($allFiles | Where-Object { $priorityExtensions -contains $_.Extension.ToLowerInvariant() })
        $normalFiles = @($allFiles | Where-Object { $priorityExtensions -notcontains $_.Extension.ToLowerInvariant() })
        return @(($priorityFiles + $normalFiles) | Select-Object -First $maxRegisterFiles -ExpandProperty FullName)
    }

    throw '路径不存在'
}

function Get-ProcessIconDataUrl([string] $processPath) {
    if (-not $processPath -or -not (Test-Path -LiteralPath $processPath -PathType Leaf)) {
        return $null
    }

    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($processPath)
        if (-not $icon) {
            return $null
        }

        $bitmap = $icon.ToBitmap()
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
        $stream.Dispose()
        $bitmap.Dispose()
        $icon.Dispose()
        return $dataUrl
    } catch {
        return $null
    }
}


function Normalize-DirectoryPath([string] $path) {
    if (-not $path) {
        return $null
    }

    return $path.TrimEnd('\').ToLowerInvariant()
}

function Test-IsDirectoryInsideTarget([string] $directoryPath, [string] $targetDirectory) {
    $normalizedDirectory = Normalize-DirectoryPath $directoryPath
    $normalizedTarget = Normalize-DirectoryPath $targetDirectory
    if (-not $normalizedDirectory -or -not $normalizedTarget) {
        return $false
    }

    return $normalizedDirectory -eq $normalizedTarget -or $normalizedDirectory.StartsWith($normalizedTarget + '\')
}

function Get-DirectoryLockProcesses([string] $path) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        return @()
    }

    $resolvedTarget = (Resolve-Path -LiteralPath $path).ProviderPath
    $currentProcessId = $PID
    Get-Process |
        Where-Object { $_.Id -ne $currentProcessId } |
        ForEach-Object {
            $process = $_
            $currentDirectory = $null
            try {
                $currentDirectory = [ProcessDirectoryNative]::GetCurrentDirectory($process.Id)
            } catch {
                $currentDirectory = $null
            }

            if (-not (Test-IsDirectoryInsideTarget $currentDirectory $resolvedTarget)) {
                return
            }

            $processPath = $null
            $processIcon = $null
            try {
                $processPath = $process.MainModule.FileName
                $processIcon = Get-ProcessIconDataUrl $processPath
            } catch {
                $processPath = $null
            }

            [PSCustomObject]@{
                pid = $process.Id
                name = if ($process.ProcessName) { "$($process.ProcessName).exe" } else { "PID $($process.Id)" }
                path = $processPath
                iconDataUrl = $processIcon
                lockedPath = $currentDirectory
            }
        }
}


function Get-PathRelatedProcesses([string] $path) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        return @()
    }

    $resolvedTarget = (Resolve-Path -LiteralPath $path).ProviderPath
    $normalizedTarget = Normalize-DirectoryPath $resolvedTarget
    if (-not $normalizedTarget) {
        return @()
    }

    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $processPath = Normalize-DirectoryPath $_.ExecutablePath
            $commandLine = if ($_.CommandLine) { $_.CommandLine.ToLowerInvariant() } else { '' }
            ($processPath -and ($processPath -eq $normalizedTarget -or $processPath.StartsWith($normalizedTarget + '\'))) -or
                $commandLine.Contains($normalizedTarget)
        } |
        ForEach-Object {
            $processPath = $_.ExecutablePath
            $processIcon = Get-ProcessIconDataUrl $processPath
            [PSCustomObject]@{
                pid = [int]$_.ProcessId
                name = if ($_.Name) { $_.Name } else { "PID $($_.ProcessId)" }
                path = $processPath
                iconDataUrl = $processIcon
                lockedPath = $resolvedTarget
            }
        }
}

$files = Resolve-RegisterFiles $targetPath
$directoryProcesses = @(Get-DirectoryLockProcesses $targetPath)
$pathRelatedProcesses = @(Get-PathRelatedProcesses $targetPath)
if ($files.Count -eq 0) {
    @($directoryProcesses + $pathRelatedProcesses) | Group-Object -Property pid | ForEach-Object { $_.Group | Select-Object -First 1 } | ConvertTo-Json -Compress
    exit 0
}

$session = 0
$sessionKey = [Guid]::NewGuid().ToString()
$startResult = [RestartManagerNative]::RmStartSession([ref] $session, 0, $sessionKey)
if ($startResult -ne 0) {
    throw "Restart Manager 会话创建失败：$startResult"
}

try {
    $registerResult = [RestartManagerNative]::RmRegisterResources($session, [uint32] $files.Count, [string[]] $files, 0, [IntPtr]::Zero, 0, $null)
    if ($registerResult -ne 0) {
        throw "Restart Manager 注册资源失败：$registerResult"
    }

    $needed = 0
    $count = 0
    $rebootReasons = 0
    $restartManagerProcesses = @()
    $queryResult = [RestartManagerNative]::RmGetList($session, [ref] $needed, [ref] $count, $null, [ref] $rebootReasons)
    if ($queryResult -eq 0 -and $needed -eq 0) {
        $restartManagerProcesses = @()
    } elseif ($queryResult -ne 234) {
        throw "Restart Manager ???????$queryResult"
    } else {
        $count = $needed
        $processInfo = New-Object RestartManagerNative+RM_PROCESS_INFO[] $count
        $queryResult = [RestartManagerNative]::RmGetList($session, [ref] $needed, [ref] $count, $processInfo, [ref] $rebootReasons)
        if ($queryResult -ne 0) {
            throw "Restart Manager ???????$queryResult"
        }

        $restartManagerProcesses = @($processInfo |
            Select-Object -First $count |
            ForEach-Object {
                $processId = $_.Process.dwProcessId
                $processName = $_.strAppName
                $processPath = $null
                $processIcon = $null

                try {
                    $process = Get-Process -Id $processId -ErrorAction Stop
                    if ($process.ProcessName) {
                        $processName = "$($process.ProcessName).exe"
                    }
                    try {
                        $processPath = $process.MainModule.FileName
                        $processIcon = Get-ProcessIconDataUrl $processPath
                    } catch {
                        $processPath = $null
                    }
                } catch {
                    if (-not $processName) {
                        $processName = "PID $processId"
                    }
                }

                [PSCustomObject]@{
                    pid = $processId
                    name = $processName
                    path = $processPath
                    iconDataUrl = $processIcon
                    lockedPath = $targetPath
                }
            })
    }

    @($restartManagerProcesses + $directoryProcesses + $pathRelatedProcesses) |
        Group-Object -Property pid |
        ForEach-Object { $_.Group | Select-Object -First 1 } |
        ConvertTo-Json -Compress
} finally {
    [void] [RestartManagerNative]::RmEndSession($session)
}
`;
function isAbortError(error) {
    return error instanceof Error && (error.name === 'AbortError' || error.message.includes('The operation was aborted'));
}
async function scanWindowsPath(path, options = {}, currentPid = process.pid) {
    try {
        const targetPath = path.trim();
        if (!targetPath) {
            throw new scanner_1.ReadableException('请选择要检测的文件或文件夹');
        }
        await (0, promises_1.access)(targetPath);
        await (0, promises_1.stat)(targetPath);
        const scriptPath = (0, node_path_1.join)((0, node_os_1.tmpdir)(), `file-unlocker-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
        await (0, promises_1.writeFile)(scriptPath, `${String.fromCharCode(0xfeff)}${restartManagerScript}`, { encoding: 'utf16le' });
        let stdout = '';
        try {
            const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
                env: {
                    ...process.env,
                    FILE_UNLOCKER_TARGET: targetPath,
                    FILE_UNLOCKER_RECURSIVE: options.recursive === false ? 'false' : 'true',
                },
                maxBuffer: 1024 * 1024 * 4,
                windowsHide: true,
                signal: options.signal,
            });
            stdout = result.stdout;
        }
        finally {
            try {
                await (0, promises_1.unlink)(scriptPath);
            }
            catch (cleanupError) {
                log.error('Failed to clean temporary scan script', cleanupError);
            }
        }
        const output = stdout.trim();
        const rawProcesses = output ? JSON.parse(output) : [];
        const processInputs = Array.isArray(rawProcesses) ? rawProcesses : [rawProcesses];
        return {
            path: targetPath,
            processes: processInputs.map((processInfo) => (0, process_1.markProcessRisk)(processInfo, currentPid)),
            scannedAt: new Date().toISOString(),
        };
    }
    catch (error) {
        if (error instanceof scanner_1.ReadableException) {
            throw error;
        }
        if (isAbortError(error)) {
            throw new scanner_1.ReadableException('扫描已取消', error);
        }
        log.error('扫描占用进程失败', error);
        throw new scanner_1.ReadableException('扫描失败，请确认路径存在且当前用户有访问权限', error);
    }
}
async function killWindowsProcesses(pids) {
    const results = [];
    for (const pid of pids) {
        try {
            await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
                windowsHide: true,
            });
            results.push({ pid, success: true });
        }
        catch (error) {
            log.error(`结束进程失败: ${pid}`, error);
            results.push({
                pid,
                success: false,
                message: '结束进程失败，请检查权限或进程状态',
            });
        }
    }
    return results;
}
