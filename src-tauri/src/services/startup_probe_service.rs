use crate::models::deployment::{
    HttpProbeConfig, LogProbeConfig, PortProbeConfig, ProbeStatus, ProcessProbeConfig,
    StartupProbeConfig,
};
use crate::services::ssh_transport_service::SshConnection;
use chrono::Utc;
use std::thread;
use std::time::{Duration, Instant};

pub struct ProbeResult {
    pub success: bool,
    pub reason: String,
    pub pid: Option<String>,
    pub log_path: Option<String>,
    pub probe_statuses: Vec<ProbeStatus>,
}

pub fn run_startup_probe(
    conn: &mut SshConnection,
    config: &StartupProbeConfig,
    context: &ProbeContext,
    is_cancelled: &dyn Fn() -> bool,
    on_status: &dyn Fn(&[ProbeStatus]),
    on_log: &dyn Fn(&str),
) -> Result<ProbeResult, String> {
    let deadline = Instant::now() + Duration::from_secs(config.timeout_seconds.max(1));
    let interval = Duration::from_secs(config.interval_seconds.max(1).min(30));

    let mut http_success_count: u32 = 0;
    let mut port_success_count: u32 = 0;
    let mut log_success_matched = false;
    let mut detected_pid: Option<String> = None;
    let mut detected_log_path = resolve_initial_log_path(config, context);
    let mut attempts: u32 = 0;
    let mut ever_seen_process_alive = false;
    let mut log_lines_emitted: usize = 0;

    if let Some(process_probe) = &config.process_probe {
        if process_probe.enabled {
            detected_pid = read_pid_from_candidates(conn, process_probe, context, is_cancelled);
        }
    }

    while Instant::now() < deadline {
        if is_cancelled() {
            return Err("部署已停止。".to_string());
        }

        attempts += 1;
        let mut statuses = Vec::new();

        let process_alive = check_process_probe(
            conn,
            config,
            context,
            &mut detected_pid,
            ever_seen_process_alive,
            &mut statuses,
        );
        let port_open = check_port_probe(conn, config, context, &mut statuses);
        let http_ok = check_http_probe(conn, config, context, &mut statuses);
        let log_result =
            check_log_probe(conn, config, context, &mut detected_log_path, &mut statuses);

        if process_alive {
            ever_seen_process_alive = true;
        }

        if log_result.failure_matched {
            emit_log_excerpt(on_log, &log_result.content);
        }

        if let Some(log_path) = &detected_log_path {
            // Incremental read: only emit lines that haven't been sent yet
            let total_cmd = format!("wc -l {} 2>/dev/null || echo 0", shell_quote(log_path));
            if let Ok(wc_result) =
                conn.execute_privileged_with_cancel(&total_cmd, || is_cancelled())
            {
                if let Ok(total_lines) = wc_result
                    .output
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("0")
                    .parse::<usize>()
                {
                    if total_lines > log_lines_emitted {
                        let skip = log_lines_emitted;
                        let tail_cmd = format!(
                            "tail -n +{} {} 2>/dev/null || true",
                            skip + 1,
                            shell_quote(log_path)
                        );
                        if let Ok(result) =
                            conn.execute_privileged_with_cancel(&tail_cmd, || is_cancelled())
                        {
                            for line in result.output.lines() {
                                on_log(line);
                            }
                        }
                        log_lines_emitted = total_lines;
                    }
                }
            }
        }

        if let Some(process_probe) = &config.process_probe {
            if process_probe.enabled && ever_seen_process_alive && !process_alive {
                emit_log_excerpt(on_log, &log_result.content);
                return Ok(ProbeResult {
                    success: false,
                    reason: "启动失败：本次探针曾确认进程存活，但随后该进程已退出。".to_string(),
                    pid: detected_pid,
                    log_path: detected_log_path,
                    probe_statuses: statuses,
                });
            }
        }

        if log_result.failure_matched {
            return Ok(ProbeResult {
                success: false,
                reason: format!(
                    "启动失败：日志命中强失败关键字：{}",
                    log_result.failure_keyword
                ),
                pid: detected_pid,
                log_path: detected_log_path,
                probe_statuses: statuses,
            });
        }

        if http_ok {
            http_success_count += 1;
        } else {
            http_success_count = 0;
        }

        if port_open {
            port_success_count += 1;
        } else {
            port_success_count = 0;
        }

        if log_result.success_matched {
            log_success_matched = true;
        }

        let success = evaluate_success(
            config,
            process_alive,
            port_success_count,
            http_success_count,
            log_success_matched,
        );

        if let Some(reason) = success {
            return Ok(ProbeResult {
                success: true,
                reason,
                pid: detected_pid,
                log_path: detected_log_path,
                probe_statuses: statuses,
            });
        }

        on_status(&statuses);

        let sleep_deadline = Instant::now() + interval;
        while Instant::now() < sleep_deadline {
            if is_cancelled() {
                return Err("部署已停止。".to_string());
            }
            thread::sleep(Duration::from_millis(250));
        }
    }

    let mut final_statuses = Vec::new();
    final_statuses.push(ProbeStatus {
        probe_type: "timeout".to_string(),
        status: "failed".to_string(),
        message: Some(format!("启动探针检测超时（{}秒）", config.timeout_seconds)),
        check_count: Some(attempts),
        last_check_at: Some(Utc::now().to_rfc3339()),
    });

    Ok(ProbeResult {
        success: false,
        reason: format!("启动探针检测超时（{}秒）", config.timeout_seconds),
        pid: detected_pid,
        log_path: detected_log_path,
        probe_statuses: final_statuses,
    })
}

pub struct ProbeContext {
    pub remote_deploy_path: String,
    pub artifact_name: String,
    pub remote_artifact_name: String,
    pub remote_artifact_base_name: String,
    pub default_pid_file: String,
    pub deploy_log_name: String,
    pub deploy_log_path: String,
    pub log_path_file: String,
    pub custom_log_path: Option<String>,
    pub enable_deploy_log: bool,
    pub _log_encoding: String,
    pub log_offset_before_start: Option<u64>,
}

impl ProbeContext {
    pub fn new(
        remote_deploy_path: &str,
        artifact_name: &str,
        remote_artifact_name: &str,
        custom_log_path: Option<&str>,
        enable_deploy_log: bool,
        log_naming_mode: &str,
        log_name: Option<&str>,
        log_encoding: &str,
    ) -> Self {
        let base_name = remote_artifact_name
            .rsplit_once('.')
            .map(|(name, _)| name)
            .unwrap_or(remote_artifact_name);
        let today = chrono::Local::now().format("%Y%m%d").to_string();
        let deploy_log_name = match log_naming_mode {
            "fixed" => log_name.unwrap_or(base_name).to_string(),
            _ => format!("{}-{}", base_name, today),
        };
        let deploy_log_path = match log_naming_mode {
            _ => format!("{}/logs/{}.log", remote_deploy_path, deploy_log_name),
        };
        Self {
            remote_deploy_path: remote_deploy_path.to_string(),
            artifact_name: artifact_name.to_string(),
            remote_artifact_name: remote_artifact_name.to_string(),
            remote_artifact_base_name: base_name.to_string(),
            default_pid_file: format!("{}/{}.pid", remote_deploy_path, base_name),
            deploy_log_name,
            deploy_log_path,
            log_path_file: format!("{}/{}.log.path", remote_deploy_path, base_name),
            custom_log_path: custom_log_path.map(|s| s.to_string()),
            enable_deploy_log,
            _log_encoding: log_encoding.to_string(),
            log_offset_before_start: None,
        }
    }
}

fn resolve_initial_log_path(config: &StartupProbeConfig, context: &ProbeContext) -> Option<String> {
    if let Some(log_probe) = &config.log_probe {
        if !log_probe.enabled {
            return None;
        }
        if let Some(log_path) = &log_probe.log_path {
            return Some(expand_probe_tokens(log_path, context));
        }
    }

    if let Some(custom) = &context.custom_log_path {
        return Some(resolve_probe_log_file(custom, context));
    }
    if context.enable_deploy_log {
        return Some(context.deploy_log_path.clone());
    }
    None
}

fn read_pid_from_candidates(
    conn: &mut SshConnection,
    process_probe: &ProcessProbeConfig,
    context: &ProbeContext,
    is_cancelled: &dyn Fn() -> bool,
) -> Option<String> {
    for pid_file in pid_file_candidates(process_probe, context) {
        let cmd = format!("cat {} 2>/dev/null", shell_quote(&pid_file));
        if let Ok(result) = conn.execute_privileged_with_cancel(&cmd, || is_cancelled()) {
            let pid = result.output.trim().to_string();
            if !pid.is_empty() && pid.chars().all(|c| c.is_ascii_digit()) {
                return Some(pid);
            }
        }
    }
    None
}

fn pid_file_candidates(process_probe: &ProcessProbeConfig, context: &ProbeContext) -> Vec<String> {
    if let Some(pid_file) = process_probe
        .pid_file
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return vec![expand_probe_tokens(pid_file, context)];
    }

    let mut candidates = vec![context.default_pid_file.clone()];
    let legacy_full_name_pid = format!(
        "{}/{}.pid",
        context.remote_deploy_path, context.remote_artifact_name
    );
    if legacy_full_name_pid != context.default_pid_file {
        candidates.push(legacy_full_name_pid);
    }
    candidates
}

fn check_process_probe(
    conn: &mut SshConnection,
    config: &StartupProbeConfig,
    context: &ProbeContext,
    detected_pid: &mut Option<String>,
    ever_seen_process_alive: bool,
    statuses: &mut Vec<ProbeStatus>,
) -> bool {
    let process_probe = match &config.process_probe {
        Some(p) if p.enabled => p,
        _ => return true,
    };

    let pid = match detected_pid {
        Some(p) if !p.is_empty() => p.clone(),
        _ => match read_pid_from_candidates(conn, process_probe, context, &|| false) {
            Some(pid) => {
                *detected_pid = Some(pid.clone());
                pid
            }
            None => {
                statuses.push(ProbeStatus {
                    probe_type: "process".to_string(),
                    status: "unknown".to_string(),
                    message: Some("未读取到 PID 文件".to_string()),
                    check_count: None,
                    last_check_at: Some(Utc::now().to_rfc3339()),
                });
                return false;
            }
        },
    };

    if pid.is_empty() {
        statuses.push(ProbeStatus {
            probe_type: "process".to_string(),
            status: "unknown".to_string(),
            message: Some("PID 文件为空".to_string()),
            check_count: None,
            last_check_at: Some(Utc::now().to_rfc3339()),
        });
        return false;
    }

    let cmd = format!("kill -0 {} 2>/dev/null", shell_quote(&pid));
    let alive = conn.execute_privileged_with_cancel(&cmd, || false).is_ok();

    statuses.push(ProbeStatus {
        probe_type: "process".to_string(),
        status: if alive {
            "alive"
        } else if ever_seen_process_alive {
            "dead"
        } else {
            "warning"
        }
        .to_string(),
        message: Some(if alive {
            format!("PID {} 存活", pid)
        } else if ever_seen_process_alive {
            format!("PID {} 已退出", pid)
        } else {
            format!(
                "PID {} 未存活，可能是旧 PID 文件；继续使用端口/HTTP/日志判断",
                pid
            )
        }),
        check_count: None,
        last_check_at: Some(Utc::now().to_rfc3339()),
    });

    alive
}

fn check_port_probe(
    conn: &mut SshConnection,
    config: &StartupProbeConfig,
    context: &ProbeContext,
    statuses: &mut Vec<ProbeStatus>,
) -> bool {
    let port_probe = match &config.port_probe {
        Some(p) if p.enabled => p,
        _ => return false,
    };

    let host = expand_probe_tokens(&port_probe.host, context);
    let cmd = format!(
        "if command -v nc >/dev/null 2>&1; then nc -z -w 3 {host} {port}; else timeout 3 bash -lc {target}; fi",
        host = shell_quote(&host),
        port = port_probe.port,
        target = shell_quote(&format!("cat < /dev/null > /dev/tcp/{}/{}", host, port_probe.port)),
    );

    let open = conn.execute_privileged_with_cancel(&cmd, || false).is_ok();

    statuses.push(ProbeStatus {
        probe_type: "port".to_string(),
        status: if open { "open" } else { "closed" }.to_string(),
        message: Some(if open {
            format!("{}:{} 已监听", host, port_probe.port)
        } else {
            format!("{}:{} 未监听", host, port_probe.port)
        }),
        check_count: None,
        last_check_at: Some(Utc::now().to_rfc3339()),
    });

    open
}

fn check_http_probe(
    conn: &mut SshConnection,
    config: &StartupProbeConfig,
    context: &ProbeContext,
    statuses: &mut Vec<ProbeStatus>,
) -> bool {
    let http_probe = match &config.http_probe {
        Some(p) if p.enabled => p,
        _ => return false,
    };

    let url = match &http_probe.url {
        Some(u) => expand_probe_tokens(u, context),
        None => return false,
    };

    let method = if http_probe.method.is_empty() {
        "GET"
    } else {
        &http_probe.method
    };

    let cmd = format!(
        "curl -sS -L -X {} -w '\\n__HTTP_STATUS__:%{{http_code}}' --max-time 15 {}",
        shell_quote(method),
        shell_quote(&url),
    );

    let expected_codes = http_probe
        .expected_status_codes
        .as_deref()
        .unwrap_or(&[200]);
    let expected_body = http_probe.expected_body_contains.as_deref();

    match conn.execute_privileged_with_cancel(&cmd, || false) {
        Ok(result) => {
            let marker = "__HTTP_STATUS__:";
            if let Some(marker_index) = result.output.rfind(marker) {
                let body = result.output[..marker_index].trim_end().to_string();
                let status_str = result.output[marker_index + marker.len()..].trim();
                if let Ok(status_code) = status_str.parse::<u16>() {
                    let status_matched = expected_codes.contains(&status_code);
                    let body_matched = expected_body
                        .map(|keyword| body.contains(keyword))
                        .unwrap_or(true);
                    let ok = status_matched && body_matched;

                    statuses.push(ProbeStatus {
                        probe_type: "http".to_string(),
                        status: if ok { "success" } else { "failed" }.to_string(),
                        message: Some(if ok {
                            format!("HTTP {} {}", status_code, url)
                        } else {
                            format!(
                                "HTTP {} 不满足条件（期望状态码 {:?}{}）",
                                status_code,
                                expected_codes,
                                expected_body
                                    .map(|k| format!("，响应需包含 {}", k))
                                    .unwrap_or_default()
                            )
                        }),
                        check_count: None,
                        last_check_at: Some(Utc::now().to_rfc3339()),
                    });
                    return ok;
                }
            }
            statuses.push(ProbeStatus {
                probe_type: "http".to_string(),
                status: "failed".to_string(),
                message: Some("HTTP 检查未返回有效状态码".to_string()),
                check_count: None,
                last_check_at: Some(Utc::now().to_rfc3339()),
            });
            false
        }
        Err(_) => {
            statuses.push(ProbeStatus {
                probe_type: "http".to_string(),
                status: "failed".to_string(),
                message: Some(format!("HTTP 请求失败：{}", url)),
                check_count: None,
                last_check_at: Some(Utc::now().to_rfc3339()),
            });
            false
        }
    }
}

struct LogCheckResult {
    success_matched: bool,
    failure_matched: bool,
    failure_keyword: String,
    content: String,
}

fn emit_log_excerpt(on_log: &dyn Fn(&str), content: &str) {
    if content.trim().is_empty() {
        return;
    }
    on_log("===== 启动失败日志片段 =====");
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(120);
    for line in &lines[start..] {
        on_log(line);
    }
    on_log("===== 启动失败日志片段结束 =====");
}

fn check_log_probe(
    conn: &mut SshConnection,
    config: &StartupProbeConfig,
    context: &ProbeContext,
    detected_log_path: &mut Option<String>,
    statuses: &mut Vec<ProbeStatus>,
) -> LogCheckResult {
    let log_probe = match &config.log_probe {
        Some(p) if p.enabled => p,
        _ => {
            return LogCheckResult {
                success_matched: false,
                failure_matched: false,
                failure_keyword: String::new(),
                content: String::new(),
            }
        }
    };

    if detected_log_path.is_none() || log_probe.only_current_deploy_log {
        if let Some(resolved) =
            resolve_runtime_log_path(conn, context, detected_log_path.as_deref())
        {
            *detected_log_path = Some(resolved);
        }
    }

    let log_path = match detected_log_path {
        Some(p) => p.clone(),
        None => {
            statuses.push(ProbeStatus {
                probe_type: "log".to_string(),
                status: "unknown".to_string(),
                message: Some("未找到启动日志路径".to_string()),
                check_count: None,
                last_check_at: Some(Utc::now().to_rfc3339()),
            });
            return LogCheckResult {
                success_matched: false,
                failure_matched: false,
                failure_keyword: String::new(),
                content: String::new(),
            };
        }
    };

    let cmd = format!("tail -n 500 {} 2>/dev/null || true", shell_quote(&log_path));
    let content = match conn.execute_privileged_with_cancel(&cmd, || false) {
        Ok(result) => result.output,
        Err(_) => {
            statuses.push(ProbeStatus {
                probe_type: "log".to_string(),
                status: "unknown".to_string(),
                message: Some("无法读取日志文件".to_string()),
                check_count: None,
                last_check_at: Some(Utc::now().to_rfc3339()),
            });
            return LogCheckResult {
                success_matched: false,
                failure_matched: false,
                failure_keyword: String::new(),
                content: String::new(),
            };
        }
    };

    let mut failure_keyword = String::new();
    let mut failure_matched = false;
    for pattern in &log_probe.failure_patterns {
        let matched = if log_probe.use_regex {
            regex_match(pattern, &content)
        } else {
            content.contains(pattern.as_str())
        };
        if matched {
            failure_matched = true;
            failure_keyword = pattern.clone();
            break;
        }
    }

    let mut success_matched = false;
    for pattern in &log_probe.success_patterns {
        let matched = if log_probe.use_regex {
            regex_match(pattern, &content)
        } else {
            content.contains(pattern.as_str())
        };
        if matched {
            success_matched = true;
            break;
        }
    }

    let mut warning_matched = false;
    let mut warning_keyword = String::new();
    for pattern in &log_probe.warning_patterns {
        let matched = if log_probe.use_regex {
            regex_match(pattern, &content)
        } else {
            content.contains(pattern.as_str())
        };
        if matched {
            warning_matched = true;
            warning_keyword = pattern.clone();
            break;
        }
    }

    let status = if failure_matched {
        "failed"
    } else if success_matched {
        "success"
    } else if warning_matched {
        "warning"
    } else {
        "checking"
    };

    let message = if failure_matched {
        format!("日志命中强失败关键字：{}", failure_keyword)
    } else if success_matched {
        "日志命中成功关键字".to_string()
    } else if warning_matched {
        format!("日志命中告警关键字：{}（不直接判失败）", warning_keyword)
    } else {
        "已发现启动日志，未发现失败关键字".to_string()
    };

    statuses.push(ProbeStatus {
        probe_type: "log".to_string(),
        status: status.to_string(),
        message: Some(message),
        check_count: None,
        last_check_at: Some(Utc::now().to_rfc3339()),
    });

    LogCheckResult {
        success_matched,
        failure_matched,
        failure_keyword,
        content,
    }
}

fn resolve_runtime_log_path(
    conn: &mut SshConnection,
    context: &ProbeContext,
    current_log_path: Option<&str>,
) -> Option<String> {
    let pointer_cmd = format!("cat {} 2>/dev/null", shell_quote(&context.log_path_file));
    if let Ok(result) = conn.execute_privileged_with_cancel(&pointer_cmd, || false) {
        let path = result.output.trim();
        if !path.is_empty() {
            return Some(path.to_string());
        }
    }

    if let Some(current) = current_log_path {
        if remote_file_exists(conn, current) {
            return Some(current.to_string());
        }
    }

    latest_log_from_globs(conn, context)
}

fn latest_log_from_globs(conn: &mut SshConnection, context: &ProbeContext) -> Option<String> {
    let commands = [
        format!(
            "ls -t {}/{}-*.log 2>/dev/null | head -n 1",
            shell_quote(&format!("{}/logs", context.remote_deploy_path)),
            shell_glob_fragment(&context.remote_artifact_base_name)
        ),
        format!(
            "ls -t {}/{}.*.log 2>/dev/null | head -n 1",
            shell_quote(&context.remote_deploy_path),
            shell_glob_fragment(&context.remote_artifact_name)
        ),
        format!(
            "ls -t {}/{}*.log 2>/dev/null | head -n 1",
            shell_quote(&context.remote_deploy_path),
            shell_glob_fragment(&context.remote_artifact_base_name)
        ),
    ];

    for command in commands {
        if let Ok(result) = conn.execute_privileged_with_cancel(&command, || false) {
            let path = result.output.lines().next().unwrap_or("").trim();
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }
    None
}

fn remote_file_exists(conn: &mut SshConnection, path: &str) -> bool {
    let command = format!("test -f {}", shell_quote(path));
    conn.execute_privileged_with_cancel(&command, || false)
        .is_ok()
}

fn evaluate_success(
    config: &StartupProbeConfig,
    process_alive: bool,
    port_success_count: u32,
    http_success_count: u32,
    log_success_matched: bool,
) -> Option<String> {
    let has_http = config
        .http_probe
        .as_ref()
        .map(|p| p.enabled && p.url.is_some())
        .unwrap_or(false);
    let has_port = config
        .port_probe
        .as_ref()
        .map(|p| p.enabled)
        .unwrap_or(false);
    let has_log = config
        .log_probe
        .as_ref()
        .map(|p| p.enabled)
        .unwrap_or(false);
    let log_success_required = config
        .log_probe
        .as_ref()
        .map(|p| p.enabled && !p.success_patterns.is_empty())
        .unwrap_or(false);
    let has_process = config
        .process_probe
        .as_ref()
        .map(|p| p.enabled)
        .unwrap_or(false);

    let process_ok = !has_process || process_alive;

    if has_http && http_success_count > 0 {
        let required = config
            .http_probe
            .as_ref()
            .map(|p| p.consecutive_successes)
            .unwrap_or(2);
        if has_log && (config.success_policy == "all" || log_success_required) {
            if process_ok && http_success_count >= required && log_success_matched {
                return Some("HTTP 健康检查成功且日志出现启动成功关键字".to_string());
            }
        } else if process_ok && http_success_count >= required {
            return Some(format!("HTTP 健康检查连续成功 {} 次", http_success_count));
        }
    }

    if has_port && port_success_count > 0 {
        let required = config
            .port_probe
            .as_ref()
            .map(|p| p.consecutive_successes)
            .unwrap_or(2);
        if has_log && (config.success_policy == "all" || log_success_required) {
            if process_ok && port_success_count >= required && log_success_matched {
                return Some("端口已监听且日志出现启动成功关键字".to_string());
            }
        } else if process_ok && port_success_count >= required {
            return Some(format!("端口已监听，连续成功 {} 次", port_success_count));
        }
    }

    if has_log && !has_http && !has_port {
        if process_ok && log_success_matched {
            return Some("日志出现启动成功关键字".to_string());
        }
    }

    None
}

fn expand_probe_tokens(value: &str, context: &ProbeContext) -> String {
    let now = chrono::Local::now();
    let today = now.format("%Y%m%d").to_string();
    let timestamp = now.format("%Y%m%d%H%M%S").to_string();
    let artifact_base_name = context
        .artifact_name
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(&context.artifact_name);
    value
        .replace(
            "${remoteArtifactName%.*}",
            &context.remote_artifact_base_name,
        )
        .replace("${artifactName%.*}", artifact_base_name)
        .replace("${remoteDeployPath}", &context.remote_deploy_path)
        .replace("${artifactName}", &context.artifact_name)
        .replace("${remoteArtifactName}", &context.remote_artifact_name)
        .replace(
            "${remoteArtifactBaseName}",
            &context.remote_artifact_base_name,
        )
        .replace("${date}", &today)
        .replace("${timestamp}", &timestamp)
        .replace("${logName}", &context.deploy_log_name)
        .replace("${logFile}", &context.deploy_log_path)
        .replace("${logPathFile}", &context.log_path_file)
        .replace("${pidFile}", &context.default_pid_file)
}

fn resolve_probe_log_file(value: &str, context: &ProbeContext) -> String {
    let resolved = expand_probe_tokens(value, context);
    if is_explicit_log_file(&resolved) {
        return resolved;
    }

    format!(
        "{}/{}.log",
        resolved.trim_end_matches('/'),
        context.deploy_log_name
    )
}

fn is_explicit_log_file(path: &str) -> bool {
    path.trim_end()
        .rsplit_once('/')
        .map(|(_, name)| name)
        .unwrap_or(path)
        .to_ascii_lowercase()
        .ends_with(".log")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn shell_glob_fragment(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        .collect()
}

fn regex_match(pattern: &str, content: &str) -> bool {
    regex::Regex::new(pattern)
        .map(|re| re.is_match(content))
        .unwrap_or(false)
}

#[allow(dead_code)]
fn create_default_startup_probe() -> StartupProbeConfig {
    StartupProbeConfig {
        enabled: true,
        timeout_seconds: 120,
        interval_seconds: 3,
        process_probe: Some(ProcessProbeConfig {
            enabled: true,
            pid_file: None,
        }),
        port_probe: Some(PortProbeConfig {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port: 8080,
            consecutive_successes: 2,
        }),
        http_probe: Some(HttpProbeConfig {
            enabled: false,
            url: Some("http://127.0.0.1:8080/actuator/health".to_string()),
            method: "GET".to_string(),
            expected_status_codes: Some(vec![200]),
            expected_body_contains: Some("UP".to_string()),
            consecutive_successes: 2,
        }),
        log_probe: Some(LogProbeConfig {
            enabled: true,
            log_path: None,
            success_patterns: vec!["Started".to_string()],
            failure_patterns: vec![
                "APPLICATION FAILED TO START".to_string(),
                "Application run failed".to_string(),
                "Port already in use".to_string(),
                "Web server failed to start".to_string(),
                "Address already in use".to_string(),
                "BindException".to_string(),
                "OutOfMemoryError".to_string(),
            ],
            warning_patterns: vec![
                "Exception".to_string(),
                "ERROR".to_string(),
                "WARN".to_string(),
            ],
            use_regex: false,
            only_current_deploy_log: true,
        }),
        success_policy: "health_first".to_string(),
    }
}
