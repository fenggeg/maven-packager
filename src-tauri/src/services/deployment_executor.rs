use crate::error::{to_user_error, AppResult};
use crate::models::deployment::{
    DeployStep, DeploymentProfile, DeploymentStage, DeploymentTask, StartDeploymentPayload,
};
use crate::repositories::deployment_repo;
use crate::services::ssh_transport_service::SshConnection;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const TYPE_SSH_COMMAND: &str = "ssh_command";
const TYPE_WAIT: &str = "wait";
const TYPE_PORT_CHECK: &str = "port_check";
const TYPE_HTTP_CHECK: &str = "http_check";
const TYPE_LOG_CHECK: &str = "log_check";
const TYPE_UPLOAD_FILE: &str = "upload_file";

const STRATEGY_STOP: &str = "stop";
const STRATEGY_CONTINUE: &str = "continue";
const STRATEGY_ROLLBACK: &str = "rollback";

#[derive(Clone, Default)]
pub struct DeploymentControlState {
    cancelled_task_ids: Arc<Mutex<HashSet<String>>>,
}

impl DeploymentControlState {
    fn request_cancel(&self, task_id: &str) -> AppResult<()> {
        self.cancelled_task_ids
            .lock()
            .map_err(|_| to_user_error("无法更新部署停止状态。"))?
            .insert(task_id.to_string());
        Ok(())
    }

    fn clear(&self, task_id: &str) {
        if let Ok(mut task_ids) = self.cancelled_task_ids.lock() {
            task_ids.remove(task_id);
        }
    }

    fn is_cancelled(&self, task_id: &str) -> bool {
        self.cancelled_task_ids
            .lock()
            .map(|task_ids| task_ids.contains(task_id))
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone)]
struct DeploymentContext {
    artifact_path: String,
    artifact_name: String,
    remote_deploy_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshCommandConfig {
    command: String,
    success_exit_codes: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaitConfig {
    wait_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortCheckConfig {
    host: String,
    port: u16,
    check_interval_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpCheckConfig {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    expected_status_codes: Option<Vec<u16>>,
    expected_body_contains: Option<String>,
    check_interval_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogCheckConfig {
    log_path: String,
    success_keywords: Vec<String>,
    failure_keywords: Option<Vec<String>>,
    check_interval_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadFileConfig {
    local_path: String,
    remote_path: String,
    overwrite: bool,
}

pub fn start_deployment(app: AppHandle, payload: StartDeploymentPayload) -> AppResult<String> {
    if payload.local_artifact_path.trim().is_empty() {
        return Err(to_user_error("部署前需要选择本地产物。"));
    }
    let task_id = Uuid::new_v4().to_string();
    app.state::<DeploymentControlState>().clear(&task_id);
    let spawned_task_id = task_id.clone();
    let app_handle = app.clone();
    thread::spawn(move || {
        let task = execute_deployment(&app_handle, &spawned_task_id, payload.clone());
        app_handle
            .state::<DeploymentControlState>()
            .clear(&spawned_task_id);
        match task {
            Ok(task) => {
                let _ = deployment_repo::save_deployment_task(&app_handle, task.clone());
                let _ = app_handle.emit("deployment-finished", task);
            }
            Err(error) => {
                let _ = app_handle.emit(
                    "deployment-log",
                    crate::models::deployment::DeploymentLogEvent {
                        task_id: spawned_task_id.clone(),
                        stage_key: None,
                        line: error.clone(),
                    },
                );
                let failed_task = create_failed_start_task(&spawned_task_id, &payload, error);
                let _ = deployment_repo::save_deployment_task(&app_handle, failed_task.clone());
                let _ = app_handle.emit("deployment-finished", failed_task);
            }
        }
    });
    Ok(task_id)
}

pub fn cancel_deployment(app: AppHandle, task_id: String) -> AppResult<()> {
    app.state::<DeploymentControlState>().request_cancel(&task_id)?;
    let _ = app.emit(
        "deployment-log",
        crate::models::deployment::DeploymentLogEvent {
            task_id,
            stage_key: None,
            line: "已请求停止部署，正在等待当前步骤退出。".to_string(),
        },
    );
    Ok(())
}

fn execute_deployment(
    app: &AppHandle,
    task_id: &str,
    payload: StartDeploymentPayload,
) -> AppResult<DeploymentTask> {
    let profile = deployment_repo::get_deployment_profile(app, &payload.deployment_profile_id)?;
    let server = deployment_repo::get_server_profile_for_execution(app, &payload.server_id)?;
    let artifact_path = Path::new(&payload.local_artifact_path);
    if !artifact_path.exists() {
        return Err(to_user_error("所选构建产物不存在。"));
    }
    let artifact_name = artifact_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| to_user_error("无法识别产物文件名。"))?
        .to_string();
    let context = DeploymentContext {
        artifact_path: payload.local_artifact_path.clone(),
        artifact_name: artifact_name.clone(),
        remote_deploy_path: normalize_remote_dir(&profile.remote_deploy_path),
    };
    let steps = normalized_steps(&profile, &context);
    let started = Instant::now();
    let mut task = DeploymentTask {
        id: task_id.to_string(),
        build_task_id: payload.build_task_id,
        deployment_profile_id: profile.id.clone(),
        deployment_profile_name: Some(profile.name.clone()),
        server_id: server.id.clone(),
        server_name: Some(server.name.clone()),
        module_id: profile.module_id.clone(),
        artifact_path: payload.local_artifact_path.clone(),
        artifact_name,
        status: "pending".to_string(),
        log: Vec::new(),
        stages: steps.iter().map(create_stage_from_step).collect(),
        created_at: Utc::now().to_rfc3339(),
        finished_at: None,
    };

    append_log(app, &mut task, None, format!("连接到 {}:{}", server.host, server.port));
    emit_task_update(app, &task);
    let conn = match SshConnection::connect(&server) {
        Ok(conn) => {
            append_log(app, &mut task, None, "SSH 连接建立成功".to_string());
            emit_task_update(app, &task);
            conn
        }
        Err(error) => {
            fail_first_stage(app, &mut task, error);
            return Ok(task);
        }
    };

    for step in steps.iter().filter(|step| step.enabled) {
        if finish_if_cancelled(app, &mut task, &step.id) {
            return Ok(task);
        }
        task.status = task_status_for_step(&step.step_type).to_string();
        emit_task_update(app, &task);
        match execute_step_with_retry(app, &conn, &mut task, step, &context, task_id) {
            Ok(()) => {}
            Err(error) => {
                let strategy = step.failure_strategy.as_deref().unwrap_or(STRATEGY_STOP);
                if strategy == STRATEGY_CONTINUE {
                    append_log(
                        app,
                        &mut task,
                        Some(step.id.clone()),
                        format!("步骤失败但策略为继续：{}", error),
                    );
                    continue;
                }
                if strategy == STRATEGY_ROLLBACK {
                    append_log(
                        app,
                        &mut task,
                        Some(step.id.clone()),
                        "步骤失败，回滚策略已触发；当前版本仅停止后续步骤，后续可接入回滚流水线。".to_string(),
                    );
                }
                mark_pending_stages_skipped(&mut task, "前序步骤失败，跳过。");
                task.status = "failed".to_string();
                task.finished_at = Some(Utc::now().to_rfc3339());
                emit_task_update(app, &task);
                return Ok(task);
            }
        }
    }

    task.status = "success".to_string();
    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(
        app,
        &mut task,
        None,
        format!("部署流水线完成，总耗时 {} ms", started.elapsed().as_millis()),
    );
    emit_task_update(app, &task);
    Ok(task)
}

fn execute_step_with_retry(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<()> {
    let retry_count = step.retry_count.unwrap_or(0);
    let retry_interval = step.retry_interval_seconds.unwrap_or(3);
    let mut last_error = None;

    for attempt in 0..=retry_count {
        if attempt > 0 {
            update_stage_retry(task, &step.id, attempt, retry_count);
            append_log(
                app,
                task,
                Some(step.id.clone()),
                format!("开始第 {}/{} 次重试", attempt, retry_count),
            );
            emit_task_update(app, task);
        }
        let status = running_status_for_step(&step.step_type);
        update_stage(task, &step.id, status, Some(stage_running_message(step)));
        emit_task_update(app, task);
        match execute_single_step(app, conn, task, step, context, task_id) {
            Ok(message) => {
                update_stage(task, &step.id, "success", Some(message.clone()));
                append_log(app, task, Some(step.id.clone()), message);
                emit_task_update(app, task);
                return Ok(());
            }
            Err(error) => {
                if is_cancel_requested(app, task_id) {
                    mark_cancelled(app, task, &step.id, "部署已停止。");
                    return Err(to_user_error("部署已停止。"));
                }
                last_error = Some(error.clone());
                if attempt < retry_count {
                    update_stage(
                        task,
                        &step.id,
                        status,
                        Some(format!("执行失败：{}，{} 秒后重试", error, retry_interval)),
                    );
                    append_log(app, task, Some(step.id.clone()), format!("步骤失败：{}", error));
                    emit_task_update(app, task);
                    if !sleep_with_cancel(app, task_id, retry_interval) {
                        mark_cancelled(app, task, &step.id, "部署已停止。");
                        return Err(to_user_error("部署已停止。"));
                    }
                }
            }
        }
    }

    let error = last_error.unwrap_or_else(|| "步骤执行失败。".to_string());
    let status = if error.contains("超时") { "timeout" } else { "failed" };
    update_stage(task, &step.id, status, Some(error.clone()));
    append_log(app, task, Some(step.id.clone()), format!("步骤失败：{}", error));
    emit_task_update(app, task);
    Err(to_user_error(error))
}

fn execute_single_step(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    match step.step_type.as_str() {
        TYPE_SSH_COMMAND => execute_ssh_step(app, conn, step, context, task_id),
        TYPE_WAIT => execute_wait_step(app, task, step, task_id),
        TYPE_PORT_CHECK => execute_port_check_step(app, conn, task, step, context, task_id),
        TYPE_HTTP_CHECK => execute_http_check_step(app, conn, task, step, context, task_id),
        TYPE_LOG_CHECK => execute_log_check_step(app, conn, task, step, context, task_id),
        TYPE_UPLOAD_FILE => execute_upload_step(app, conn, task, step, context, task_id),
        other => Err(to_user_error(format!("暂不支持的部署步骤类型：{}", other))),
    }
}

fn execute_ssh_step(
    app: &AppHandle,
    conn: &SshConnection,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: SshCommandConfig = parse_config(step)?;
    let mut command = expand_tokens(&config.command, context);
    if let Some(timeout) = step.timeout_seconds.filter(|value| *value > 0) {
        command = format!("timeout {} sh -lc {}", timeout, shell_quote(&command));
    }
    let result = conn.execute_allowing_status(
        &command,
        config.success_exit_codes.as_deref().unwrap_or(&[0]),
        || is_cancel_requested(app, task_id),
    )?;
    Ok(if result.output.is_empty() {
        format!("{} 执行完成，退出码 {}", step.name, result.exit_status)
    } else {
        format!("{} 输出：{}", step.name, result.output)
    })
}

fn execute_wait_step(
    app: &AppHandle,
    task: &mut DeploymentTask,
    step: &DeployStep,
    task_id: &str,
) -> AppResult<String> {
    let config: WaitConfig = parse_config(step)?;
    let wait_seconds = step
        .timeout_seconds
        .filter(|value| *value > 0)
        .map(|timeout| timeout.min(config.wait_seconds))
        .unwrap_or(config.wait_seconds);
    for elapsed in 0..wait_seconds {
        if is_cancel_requested(app, task_id) {
            return Err(to_user_error("部署已停止。"));
        }
        update_stage(
            task,
            &step.id,
            "waiting",
            Some(format!("已等待 {} / {} 秒", elapsed, wait_seconds)),
        );
        emit_task_update(app, task);
        thread::sleep(Duration::from_secs(1));
    }
    Ok(format!("等待完成：{} 秒", wait_seconds))
}

fn execute_port_check_step(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: PortCheckConfig = parse_config(step)?;
    let host = expand_tokens(&config.host, context);
    let timeout = step.timeout_seconds.unwrap_or(60).max(1);
    let interval = config.check_interval_seconds.unwrap_or(3).max(1);
    let started = Instant::now();
    let mut attempts = 0_u32;
    while started.elapsed() < Duration::from_secs(timeout) {
        if is_cancel_requested(app, task_id) {
            return Err(to_user_error("部署已停止。"));
        }
        attempts += 1;
        update_stage(
            task,
            &step.id,
            "checking",
            Some(format!(
                "第 {} 次检测 {}:{}，已等待 {} 秒",
                attempts,
                host,
                config.port,
                started.elapsed().as_secs()
            )),
        );
        emit_task_update(app, task);
        let command = format!(
            "if command -v nc >/dev/null 2>&1; then nc -z -w 3 {host} {port}; else timeout 3 bash -lc {target}; fi",
            host = shell_quote(&host),
            port = config.port,
            target = shell_quote(&format!("cat < /dev/null > /dev/tcp/{}/{}", host, config.port)),
        );
        if conn
            .execute_with_cancel(&command, || is_cancel_requested(app, task_id))
            .is_ok()
        {
            return Ok(format!("端口检测通过：{}:{}", host, config.port));
        }
        if !sleep_with_cancel(app, task_id, interval) {
            return Err(to_user_error("部署已停止。"));
        }
    }
    Err(to_user_error(format!("端口检测超时：{}:{}", host, config.port)))
}

fn execute_http_check_step(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: HttpCheckConfig = parse_config(step)?;
    let url = expand_tokens(&config.url, context);
    let timeout = step.timeout_seconds.unwrap_or(90).max(1);
    let interval = config.check_interval_seconds.unwrap_or(5).max(1);
    let expected_codes = config
        .expected_status_codes
        .clone()
        .unwrap_or_else(|| vec![200]);
    let expected_body = config
        .expected_body_contains
        .as_deref()
        .map(|value| expand_tokens(value, context))
        .filter(|value| !value.trim().is_empty());
    let started = Instant::now();
    let mut attempts = 0_u32;
    let mut last_error = "尚未收到健康响应".to_string();

    while started.elapsed() < Duration::from_secs(timeout) {
        if is_cancel_requested(app, task_id) {
            return Err(to_user_error("部署已停止。"));
        }
        attempts += 1;
        update_stage(
            task,
            &step.id,
            "checking",
            Some(format!("第 {} 次 HTTP 检查，已等待 {} 秒", attempts, started.elapsed().as_secs())),
        );
        emit_task_update(app, task);
        match run_remote_http_check(app, conn, &config, &url, task_id) {
            Ok((status, body)) => {
                let status_matched = expected_codes.contains(&status);
                let body_matched = expected_body
                    .as_ref()
                    .map(|keyword| body.contains(keyword))
                    .unwrap_or(true);
                if status_matched && body_matched {
                    return Ok(format!("HTTP 健康检查通过：{} {}", status, url));
                }
                last_error = format!(
                    "HTTP 响应未满足条件：状态码 {}，期望 {:?}{}",
                    status,
                    expected_codes,
                    expected_body
                        .as_ref()
                        .map(|keyword| format!("，响应需包含 {}", keyword))
                        .unwrap_or_default()
                );
            }
            Err(error) => {
                last_error = error;
            }
        }
        if !sleep_with_cancel(app, task_id, interval) {
            return Err(to_user_error("部署已停止。"));
        }
    }
    Err(to_user_error(format!("HTTP 健康检查超时：{}；{}", url, last_error)))
}

fn execute_log_check_step(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: LogCheckConfig = parse_config(step)?;
    let log_path = expand_tokens(&config.log_path, context);
    let timeout = step.timeout_seconds.unwrap_or(90).max(1);
    let interval = config.check_interval_seconds.unwrap_or(3).max(1);
    let started = Instant::now();
    let mut attempts = 0_u32;

    while started.elapsed() < Duration::from_secs(timeout) {
        if is_cancel_requested(app, task_id) {
            return Err(to_user_error("部署已停止。"));
        }
        attempts += 1;
        update_stage(
            task,
            &step.id,
            "checking",
            Some(format!("第 {} 次日志检测，已等待 {} 秒", attempts, started.elapsed().as_secs())),
        );
        emit_task_update(app, task);
        let command = format!("tail -n 500 {} 2>/dev/null || true", shell_quote(&log_path));
        let result = conn.execute_with_cancel(&command, || is_cancel_requested(app, task_id))?;
        let content = result.output;
        if let Some(keyword) = config
            .failure_keywords
            .as_ref()
            .and_then(|items| items.iter().find(|keyword| content.contains(keyword.as_str())))
        {
            return Err(to_user_error(format!("日志中发现失败关键字：{}", keyword)));
        }
        if let Some(keyword) = config
            .success_keywords
            .iter()
            .find(|keyword| content.contains(keyword.as_str()))
        {
            return Ok(format!("日志关键字检测通过：{}", keyword));
        }
        if !sleep_with_cancel(app, task_id, interval) {
            return Err(to_user_error("部署已停止。"));
        }
    }
    Err(to_user_error(format!("日志关键字检测超时：{}", log_path)))
}

fn execute_upload_step(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: UploadFileConfig = parse_config(step)?;
    let local_path = expand_tokens(&config.local_path, context);
    let remote_path = expand_tokens(&config.remote_path, context);
    let local = Path::new(&local_path);
    if !local.exists() {
        return Err(to_user_error(format!("上传文件不存在：{}", local_path)));
    }
    let parent_dir = remote_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .filter(|dir| !dir.trim().is_empty())
        .unwrap_or(".");
    conn.execute_with_cancel(
        &format!("mkdir -p {}", shell_quote(parent_dir)),
        || is_cancel_requested(app, task_id),
    )?;
    if !config.overwrite {
        let exists_command = format!("test ! -e {}", shell_quote(&remote_path));
        conn.execute_with_cancel(&exists_command, || is_cancel_requested(app, task_id))
            .map_err(|_| to_user_error(format!("远程文件已存在且未允许覆盖：{}", remote_path)))?;
    }

    let mut last_upload_percent = 0_u64;
    conn.upload_file_with_progress(
        local,
        &remote_path,
        || is_cancel_requested(app, task_id),
        |uploaded, total| {
            let percent = if total == 0 {
                100
            } else {
                ((uploaded.saturating_mul(100)) / total).min(100)
            };
            if percent == 100 || percent >= last_upload_percent + 1 {
                last_upload_percent = percent;
                update_stage(
                    task,
                    &step.id,
                    "running",
                    Some(format!("上传进度 {}% ({}/{})", percent, format_bytes(uploaded), format_bytes(total))),
                );
                emit_task_update(app, task);
            }
        },
    )?;
    Ok(format!("文件已上传到 {}", remote_path))
}

fn run_remote_http_check(
    app: &AppHandle,
    conn: &SshConnection,
    config: &HttpCheckConfig,
    url: &str,
    task_id: &str,
) -> Result<(u16, String), String> {
    let method = config.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let mut command = format!(
        "curl -sS -L -X {} -w '\\n__HTTP_STATUS__:%{{http_code}}' --max-time 15",
        shell_quote(&method)
    );
    if let Some(headers) = &config.headers {
        for (key, value) in headers {
            command.push_str(" -H ");
            command.push_str(&shell_quote(&format!("{}: {}", key, value)));
        }
    }
    if let Some(body) = config.body.as_deref().filter(|value| !value.is_empty()) {
        command.push_str(" --data ");
        command.push_str(&shell_quote(body));
    }
    command.push(' ');
    command.push_str(&shell_quote(url));
    let result = conn
        .execute_with_cancel(&command, || is_cancel_requested(app, task_id))
        .map_err(|error| error.to_string())?;
    let marker = "__HTTP_STATUS__:";
    let marker_index = result
        .output
        .rfind(marker)
        .ok_or_else(|| "HTTP 检查未返回状态码，请确认远端已安装 curl。".to_string())?;
    let body = result.output[..marker_index].trim_end().to_string();
    let status = result.output[marker_index + marker.len()..]
        .trim()
        .parse::<u16>()
        .map_err(|_| "HTTP 状态码解析失败。".to_string())?;
    Ok((status, body))
}

fn normalized_steps(profile: &DeploymentProfile, context: &DeploymentContext) -> Vec<DeployStep> {
    let mut steps = if profile.deployment_steps.is_empty() {
        legacy_steps_from_custom_commands(profile, context)
    } else {
        profile.deployment_steps.clone()
    };
    steps.sort_by(|left, right| left.order.cmp(&right.order).then(left.name.cmp(&right.name)));
    steps
}

fn legacy_steps_from_custom_commands(
    profile: &DeploymentProfile,
    context: &DeploymentContext,
) -> Vec<DeployStep> {
    let temp_path = format!(
        "{}/.{}.uploading",
        context.remote_deploy_path, context.artifact_name
    );
    let target_path = format!("{}/{}", context.remote_deploy_path, context.artifact_name);
    let mut steps = vec![
        create_upload_step("legacy-upload", "上传产物", 10, "${artifactPath}", &temp_path),
        create_ssh_step(
            "legacy-replace",
            "替换文件",
            40,
            &format!(
                "mkdir -p {dir} && mv -f {temp} {target}",
                dir = shell_quote(&context.remote_deploy_path),
                temp = shell_quote(&temp_path),
                target = shell_quote(&target_path),
            ),
        ),
    ];
    let mut order = 20;
    for command in &profile.custom_commands {
        if !command.enabled || command.command.trim().is_empty() {
            continue;
        }
        order += 10;
        let is_health_url = is_http_url(&command.command);
        steps.push(if is_health_url {
            create_http_step(
                &format!("legacy-{}", command.id),
                &command.name,
                order,
                &command.command,
            )
        } else {
            create_ssh_step(&format!("legacy-{}", command.id), &command.name, order, &command.command)
        });
    }
    steps
}

fn create_upload_step(id: &str, name: &str, order: i32, local_path: &str, remote_path: &str) -> DeployStep {
    DeployStep {
        id: id.to_string(),
        enabled: true,
        name: name.to_string(),
        step_type: TYPE_UPLOAD_FILE.to_string(),
        order,
        timeout_seconds: Some(120),
        retry_count: Some(0),
        retry_interval_seconds: Some(3),
        failure_strategy: Some(STRATEGY_STOP.to_string()),
        config: json!({
            "localPath": local_path,
            "remotePath": remote_path,
            "overwrite": true,
        }),
    }
}

fn create_ssh_step(id: &str, name: &str, order: i32, command: &str) -> DeployStep {
    DeployStep {
        id: id.to_string(),
        enabled: true,
        name: if name.trim().is_empty() { "SSH 命令".to_string() } else { name.to_string() },
        step_type: TYPE_SSH_COMMAND.to_string(),
        order,
        timeout_seconds: Some(60),
        retry_count: Some(0),
        retry_interval_seconds: Some(3),
        failure_strategy: Some(STRATEGY_STOP.to_string()),
        config: json!({
            "command": command,
            "successExitCodes": [0],
        }),
    }
}

fn create_http_step(id: &str, name: &str, order: i32, url: &str) -> DeployStep {
    DeployStep {
        id: id.to_string(),
        enabled: true,
        name: if name.trim().is_empty() { "HTTP 健康检查".to_string() } else { name.to_string() },
        step_type: TYPE_HTTP_CHECK.to_string(),
        order,
        timeout_seconds: Some(90),
        retry_count: Some(0),
        retry_interval_seconds: Some(3),
        failure_strategy: Some(STRATEGY_STOP.to_string()),
        config: json!({
            "url": url,
            "method": "GET",
            "expectedStatusCodes": [200],
            "expectedBodyContains": "",
            "checkIntervalSeconds": 5,
        }),
    }
}

fn create_stage_from_step(step: &DeployStep) -> DeploymentStage {
    DeploymentStage {
        key: step.id.clone(),
        label: step.name.clone(),
        step_type: Some(step.step_type.clone()),
        status: if step.enabled { "pending" } else { "skipped" }.to_string(),
        started_at: None,
        finished_at: None,
        message: if step.enabled { None } else { Some("步骤已禁用，跳过。".to_string()) },
        retry_count: step.retry_count,
        current_retry: Some(0),
        duration_ms: None,
        logs: Vec::new(),
    }
}

fn create_failed_start_task(
    task_id: &str,
    payload: &StartDeploymentPayload,
    error: String,
) -> DeploymentTask {
    let artifact_name = Path::new(&payload.local_artifact_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&payload.local_artifact_path)
        .to_string();
    let now = Utc::now().to_rfc3339();
    DeploymentTask {
        id: task_id.to_string(),
        build_task_id: payload.build_task_id.clone(),
        deployment_profile_id: payload.deployment_profile_id.clone(),
        deployment_profile_name: None,
        server_id: payload.server_id.clone(),
        server_name: None,
        module_id: String::new(),
        artifact_path: payload.local_artifact_path.clone(),
        artifact_name,
        status: "failed".to_string(),
        log: vec![error.clone()],
        stages: vec![DeploymentStage {
            key: "startup".to_string(),
            label: "启动部署".to_string(),
            step_type: None,
            status: "failed".to_string(),
            started_at: Some(now.clone()),
            finished_at: Some(now.clone()),
            message: Some(error),
            retry_count: Some(0),
            current_retry: Some(0),
            duration_ms: Some(0),
            logs: Vec::new(),
        }],
        created_at: now.clone(),
        finished_at: Some(now),
    }
}

fn fail_first_stage(app: &AppHandle, task: &mut DeploymentTask, error: String) {
    let stage_key = task
        .stages
        .first()
        .map(|stage| stage.key.clone())
        .unwrap_or_else(|| "startup".to_string());
    update_stage(task, &stage_key, "failed", Some(error.clone()));
    task.status = "failed".to_string();
    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(app, task, Some(stage_key), error);
    emit_task_update(app, task);
}

fn mark_cancelled(app: &AppHandle, task: &mut DeploymentTask, stage_key: &str, message: &str) {
    update_stage(task, stage_key, "cancelled", Some(message.to_string()));
    mark_pending_stages_skipped(task, "部署已停止，跳过。");
    task.status = "cancelled".to_string();
    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(app, task, Some(stage_key.to_string()), message.to_string());
    emit_task_update(app, task);
}

fn finish_if_cancelled(app: &AppHandle, task: &mut DeploymentTask, stage_key: &str) -> bool {
    if is_cancel_requested(app, &task.id) {
        mark_cancelled(app, task, stage_key, "部署已停止。");
        true
    } else {
        false
    }
}

fn is_cancel_requested(app: &AppHandle, task_id: &str) -> bool {
    app.state::<DeploymentControlState>().is_cancelled(task_id)
}

fn mark_pending_stages_skipped(task: &mut DeploymentTask, message: &str) {
    for stage in &mut task.stages {
        if stage.status == "pending" {
            stage.status = "skipped".to_string();
            stage.message = Some(message.to_string());
            stage.finished_at = Some(Utc::now().to_rfc3339());
        }
    }
}

fn update_stage(task: &mut DeploymentTask, stage_key: &str, status: &str, message: Option<String>) {
    if let Some(stage) = task.stages.iter_mut().find(|item| item.key == stage_key) {
        let now = Utc::now();
        if matches!(status, "running" | "checking" | "waiting") && stage.started_at.is_none() {
            stage.started_at = Some(now.to_rfc3339());
        }
        if matches!(status, "success" | "failed" | "skipped" | "cancelled" | "timeout") {
            stage.finished_at = Some(now.to_rfc3339());
            stage.duration_ms = stage
                .started_at
                .as_deref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .and_then(|started_at| {
                    now.signed_duration_since(started_at.with_timezone(&Utc))
                        .num_milliseconds()
                        .try_into()
                        .ok()
                });
        }
        stage.status = status.to_string();
        stage.message = message;
    }
}

fn update_stage_retry(task: &mut DeploymentTask, stage_key: &str, current_retry: u32, retry_count: u32) {
    if let Some(stage) = task.stages.iter_mut().find(|item| item.key == stage_key) {
        stage.current_retry = Some(current_retry);
        stage.retry_count = Some(retry_count);
    }
}

fn append_log(
    app: &AppHandle,
    task: &mut DeploymentTask,
    stage_key: Option<String>,
    line: String,
) {
    task.log.push(line.clone());
    if let Some(key) = stage_key.as_deref() {
        if let Some(stage) = task.stages.iter_mut().find(|item| item.key == key) {
            stage.logs.push(line.clone());
        }
    }
    let _ = app.emit(
        "deployment-log",
        crate::models::deployment::DeploymentLogEvent {
            task_id: task.id.clone(),
            stage_key,
            line,
        },
    );
}

fn emit_task_update(app: &AppHandle, task: &DeploymentTask) {
    let _ = app.emit("deployment-updated", task.clone());
}

fn parse_config<T>(step: &DeployStep) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value::<T>(step.config.clone())
        .map_err(|error| to_user_error(format!("步骤「{}」配置格式错误：{}", step.name, error)))
}

fn expand_tokens(value: &str, context: &DeploymentContext) -> String {
    value
        .replace("${artifactPath}", &context.artifact_path)
        .replace("${artifactName}", &context.artifact_name)
        .replace("${remoteDeployPath}", &context.remote_deploy_path)
}

fn normalize_remote_dir(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn task_status_for_step(step_type: &str) -> &'static str {
    match step_type {
        TYPE_UPLOAD_FILE => "uploading",
        TYPE_PORT_CHECK | TYPE_HTTP_CHECK | TYPE_LOG_CHECK => "checking",
        TYPE_WAIT => "checking",
        _ => "starting",
    }
}

fn running_status_for_step(step_type: &str) -> &'static str {
    match step_type {
        TYPE_WAIT => "waiting",
        TYPE_PORT_CHECK | TYPE_HTTP_CHECK | TYPE_LOG_CHECK => "checking",
        _ => "running",
    }
}

fn stage_running_message(step: &DeployStep) -> String {
    match step.step_type.as_str() {
        TYPE_WAIT => "等待中".to_string(),
        TYPE_PORT_CHECK => "端口检测中".to_string(),
        TYPE_HTTP_CHECK => "HTTP 健康检查中".to_string(),
        TYPE_LOG_CHECK => "日志关键字检测中".to_string(),
        TYPE_UPLOAD_FILE => "文件上传中".to_string(),
        _ => "执行中".to_string(),
    }
}

fn sleep_with_cancel(app: &AppHandle, task_id: &str, seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if is_cancel_requested(app, task_id) {
            return false;
        }
        thread::sleep(Duration::from_millis(250));
    }
    true
}

fn is_http_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn format_bytes(value: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    if value as f64 >= MB {
        format!("{:.1} MB", value as f64 / MB)
    } else if value as f64 >= KB {
        format!("{:.1} KB", value as f64 / KB)
    } else {
        format!("{} B", value)
    }
}
