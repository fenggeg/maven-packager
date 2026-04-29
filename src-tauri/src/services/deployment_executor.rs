use crate::error::{to_user_error, AppResult};
use crate::models::deployment::{
    BackupConfig, DeployStep, DeploymentProfile, DeploymentStage, DeploymentTask, ProbeStatus,
    ProbeStatusEvent, RollbackResult, StartDeploymentPayload, StartupProbeConfig,
    UploadProgressEvent,
};
use crate::repositories::deployment_repo;
use crate::services::ssh_transport_service::SshConnection;
use crate::services::startup_probe_service::{self, ProbeContext};
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
    remote_artifact_name: String,
    remote_deploy_path: String,
    _service_description: Option<String>,
    _service_alias: Option<String>,
    java_bin_path: Option<String>,
    jvm_options: Option<String>,
    spring_profile: Option<String>,
    extra_args: Option<String>,
    working_dir: Option<String>,
    log_path: Option<String>,
    log_naming_mode: String,
    log_name: Option<String>,
    log_encoding: String,
    enable_deploy_log: bool,
    port_probe_port: Option<u16>,
    backup_config: BackupConfig,
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

fn non_empty_option(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn deployment_port(profile: &DeploymentProfile) -> Option<u16> {
    profile
        .startup_probe
        .as_ref()
        .and_then(|config| config.port_probe.as_ref())
        .map(|probe| probe.port)
        .or_else(|| {
            profile
                .startup_probe
                .as_ref()
                .and_then(|config| config.http_probe.as_ref())
                .and_then(|probe| parse_url_port(probe.url.as_deref()))
        })
        .or_else(|| parse_port_from_steps(&profile.deployment_steps))
        .or_else(|| {
            profile
                .custom_commands
                .iter()
                .filter(|command| command.enabled)
                .find_map(|command| {
                    parse_server_port(Some(&command.command))
                        .or_else(|| parse_url_port(Some(&command.command)))
                })
        })
        .or_else(|| parse_server_port(profile.jvm_options.as_deref()))
        .or_else(|| parse_server_port(profile.extra_args.as_deref()))
}

fn parse_port_from_steps(steps: &[DeployStep]) -> Option<u16> {
    steps.iter().filter(|step| step.enabled).find_map(|step| {
        step.config
            .get("port")
            .and_then(|value| value.as_u64())
            .and_then(|port| u16::try_from(port).ok())
            .or_else(|| {
                step.config
                    .get("url")
                    .and_then(|value| value.as_str())
                    .and_then(|url| parse_url_port(Some(url)))
            })
            .or_else(|| {
                step.config
                    .get("command")
                    .and_then(|value| value.as_str())
                    .and_then(|command| parse_server_port(Some(command)))
            })
    })
}

fn parse_server_port(value: Option<&str>) -> Option<u16> {
    let value = value?;
    value
        .split_whitespace()
        .filter_map(|token| {
            let token = token.trim_matches(|ch| ch == '"' || ch == '\'');
            ["--server.port=", "-Dserver.port=", "server.port="]
                .iter()
                .find_map(|prefix| token.strip_prefix(prefix))
                .and_then(|port| port.parse::<u16>().ok())
        })
        .next()
}

fn parse_url_port(value: Option<&str>) -> Option<u16> {
    let value = value?.trim();
    let after_scheme = value
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(value);
    let host_port = after_scheme.split('/').next().unwrap_or(after_scheme);
    let port = host_port.rsplit_once(':')?.1;
    port.parse::<u16>().ok()
}

pub fn cancel_deployment(app: AppHandle, task_id: String) -> AppResult<()> {
    app.state::<DeploymentControlState>()
        .request_cancel(&task_id)?;
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
    let remote_deploy_path = profile.remote_deploy_path.trim();
    if remote_deploy_path.is_empty() {
        return Err(to_user_error("远端部署目录不能为空。"));
    }
    if remote_deploy_path == "/" {
        return Err(to_user_error("远端部署目录不能为根目录 /。"));
    }
    let artifact_path = Path::new(&payload.local_artifact_path);
    if !artifact_path.exists() {
        return Err(to_user_error("所选构建产物不存在。"));
    }
    let artifact_name = artifact_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| to_user_error("无法识别产物文件名。"))?
        .to_string();
    let remote_artifact_name = profile
        .remote_artifact_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&artifact_name)
        .to_string();
    let log_path = profile
        .log_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string());
    let log_naming_mode = profile.log_naming_mode.clone();
    let log_name = profile
        .log_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string());
    let context = DeploymentContext {
        artifact_path: payload.local_artifact_path.clone(),
        artifact_name: artifact_name.clone(),
        remote_artifact_name,
        remote_deploy_path: normalize_remote_dir(&profile.remote_deploy_path),
        _service_description: profile.service_description.clone(),
        _service_alias: profile.service_alias.clone(),
        java_bin_path: non_empty_option(profile.java_bin_path.clone()),
        jvm_options: non_empty_option(profile.jvm_options.clone()),
        spring_profile: non_empty_option(profile.spring_profile.clone()),
        extra_args: non_empty_option(profile.extra_args.clone()),
        working_dir: non_empty_option(profile.working_dir.clone()),
        log_path,
        log_naming_mode,
        log_name,
        log_encoding: profile.log_encoding.clone(),
        enable_deploy_log: profile.enable_deploy_log,
        port_probe_port: deployment_port(&profile),
        backup_config: profile.backup_config.clone(),
    };
    let steps = normalized_steps(&profile, &context);
    let started = Instant::now();
    let mut task = DeploymentTask {
        id: task_id.to_string(),
        build_task_id: payload.build_task_id,
        project_root: profile.project_root.clone(),
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
        startup_pid: None,
        startup_log_path: None,
        probe_result: None,
        backup_path: None,
        log_offset_before_start: None,
        rollback_result: None,
    };

    append_log(
        app,
        &mut task,
        None,
        format!("正在连接服务器 {}:{} ...", server.host, server.port),
    );
    emit_task_update(app, &task);
    let mut conn = match SshConnection::connect(&server, || is_cancel_requested(app, task_id)) {
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
        match execute_step_with_retry(app, &mut conn, &mut task, step, &context, task_id) {
            Ok(()) => {
                if step.id == "legacy-backup" && context.backup_config.enabled {
                    let backup_dir = context
                        .backup_config
                        .backup_dir
                        .as_deref()
                        .unwrap_or(&context.remote_deploy_path);
                    let base_name = context
                        .remote_artifact_name
                        .rsplit_once('.')
                        .map(|(n, _)| n)
                        .unwrap_or(&context.remote_artifact_name);
                    let find_latest = format!(
                        "ls -1t {backup_dir}/{base}.*.bak 2>/dev/null | head -1",
                        backup_dir = shell_quote(backup_dir),
                        base = shell_quote(base_name),
                    );
                    if let Ok(output) = conn.execute_with_cancel(&find_latest, || false) {
                        let path = output.output.trim().to_string();
                        if !path.is_empty() {
                            task.backup_path = Some(path);
                        }
                    }
                }
            }
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
                        "步骤失败，回滚策略已触发，开始执行回滚...".to_string(),
                    );
                    execute_rollback(app, &mut conn, &mut task, &context);
                }
                mark_pending_stages_skipped(&mut task, "前序步骤失败，跳过。");
                task.status = "failed".to_string();
                task.finished_at = Some(Utc::now().to_rfc3339());
                emit_task_update(app, &task);
                return Ok(task);
            }
        }
    }

    if let Some(probe_config) = &profile.startup_probe {
        if probe_config.enabled {
            match execute_startup_probe(app, &mut conn, &mut task, probe_config, &context, task_id)
            {
                Ok(()) => {
                    task.status = "success".to_string();
                }
                Err(probe_error) => {
                    task.status = "failed".to_string();
                    append_log(app, &mut task, None, probe_error.clone());
                    if context.backup_config.auto_rollback {
                        append_log(
                            app,
                            &mut task,
                            None,
                            "启动探针失败，自动回滚已触发...".to_string(),
                        );
                        execute_rollback(app, &mut conn, &mut task, &context);
                    }
                }
            }
        } else {
            task.status = "success".to_string();
            append_log(
                app,
                &mut task,
                None,
                "启动探针已禁用，部署流水线完成但未验证服务是否真正启动成功。".to_string(),
            );
        }
    } else {
        task.status = "success".to_string();
        append_log(
            app,
            &mut task,
            None,
            "未配置启动探针，无法确认服务是否真正启动成功。建议在服务映射中配置启动探针。"
                .to_string(),
        );
    }

    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(
        app,
        &mut task,
        None,
        format!(
            "部署流水线完成，总耗时 {} ms",
            started.elapsed().as_millis()
        ),
    );
    emit_task_update(app, &task);
    Ok(task)
}

fn execute_step_with_retry(
    app: &AppHandle,
    conn: &mut SshConnection,
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
                    append_log(
                        app,
                        task,
                        Some(step.id.clone()),
                        format!("步骤失败：{}", error),
                    );
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
    let status = if error.contains("超时") {
        "timeout"
    } else {
        "failed"
    };
    update_stage(task, &step.id, status, Some(error.clone()));
    append_log(
        app,
        task,
        Some(step.id.clone()),
        format!("步骤失败：{}", error),
    );
    emit_task_update(app, task);
    Err(to_user_error(error))
}

fn execute_startup_probe(
    app: &AppHandle,
    conn: &mut SshConnection,
    task: &mut DeploymentTask,
    config: &StartupProbeConfig,
    context: &DeploymentContext,
    task_id: &str,
) -> Result<(), String> {
    let probe_stage_key = "startup-probe";
    let probe_stage = DeploymentStage {
        key: probe_stage_key.to_string(),
        label: "启动探针检测".to_string(),
        step_type: Some("startup_probe".to_string()),
        status: "checking".to_string(),
        started_at: Some(Utc::now().to_rfc3339()),
        finished_at: None,
        message: Some("启动探针检测中...".to_string()),
        retry_count: None,
        current_retry: None,
        duration_ms: None,
        logs: Vec::new(),
        probe_statuses: Vec::new(),
    };
    task.stages.push(probe_stage);
    task.status = "checking".to_string();
    emit_task_update(app, task);

    append_log(
        app,
        task,
        Some(probe_stage_key.to_string()),
        format!(
            "进入启动探针检测阶段，超时 {} 秒，检测间隔 {} 秒",
            config.timeout_seconds, config.interval_seconds
        ),
    );
    emit_task_update(app, task);

    let mut probe_context = ProbeContext::new(
        &context.remote_deploy_path,
        &context.artifact_name,
        &context.remote_artifact_name,
        context.log_path.as_deref(),
        context.enable_deploy_log,
        &context.log_naming_mode,
        context.log_name.as_deref(),
        &context.log_encoding,
    );
    probe_context.log_offset_before_start = task.log_offset_before_start;

    let shared_probe_statuses: Arc<Mutex<Vec<ProbeStatus>>> = Arc::new(Mutex::new(Vec::new()));
    let shared_logs: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    let app_clone = app.clone();
    let task_id_owned = task_id.to_string();
    let probe_stage_key_owned = probe_stage_key.to_string();
    let statuses_ref = shared_probe_statuses.clone();
    let logs_ref = shared_logs.clone();

    let result = startup_probe_service::run_startup_probe(
        conn,
        config,
        &probe_context,
        &|| is_cancel_requested(app, task_id),
        &move |statuses: &[ProbeStatus]| {
            if let Ok(mut guard) = statuses_ref.lock() {
                *guard = statuses.to_vec();
            }
            let _ = app_clone.emit(
                "probe-status",
                ProbeStatusEvent {
                    task_id: task_id_owned.clone(),
                    stage_key: probe_stage_key_owned.clone(),
                    probe_statuses: statuses.to_vec(),
                },
            );
        },
        &move |line: &str| {
            if let Ok(mut guard) = logs_ref.lock() {
                guard.push(line.to_string());
            }
        },
    );

    {
        let guard = shared_logs.lock().unwrap();
        for log_line in guard.iter() {
            task.log.push(log_line.clone());
            if let Some(stage) = task.stages.iter_mut().find(|s| s.key == probe_stage_key) {
                stage.logs.push(log_line.clone());
            }
            let _ = app.emit(
                "deployment-log",
                crate::models::deployment::DeploymentLogEvent {
                    task_id: task.id.clone(),
                    stage_key: Some(probe_stage_key.to_string()),
                    line: log_line.clone(),
                },
            );
        }
    }

    {
        let guard = shared_probe_statuses.lock().unwrap();
        if let Some(stage) = task.stages.iter_mut().find(|s| s.key == probe_stage_key) {
            stage.probe_statuses = guard.clone();
        }
    }
    emit_task_update(app, task);

    match result {
        Ok(probe_result) => {
            task.startup_pid = probe_result.pid;
            task.startup_log_path = probe_result.log_path.clone();
            task.probe_result = Some(probe_result.reason.clone());

            if let Some(stage) = task.stages.iter_mut().find(|s| s.key == probe_stage_key) {
                stage.probe_statuses = probe_result.probe_statuses.clone();
                if probe_result.success {
                    stage.status = "success".to_string();
                    stage.message = Some(probe_result.reason.clone());
                    append_log(
                        app,
                        task,
                        Some(probe_stage_key.to_string()),
                        format!("启动探针检测通过：{}", probe_result.reason),
                    );
                } else {
                    stage.status = if probe_result.reason.contains("超时") {
                        "timeout".to_string()
                    } else {
                        "failed".to_string()
                    };
                    stage.message = Some(probe_result.reason.clone());
                    append_log(
                        app,
                        task,
                        Some(probe_stage_key.to_string()),
                        format!("启动探针检测失败：{}", probe_result.reason),
                    );
                }
            }

            if probe_result.success {
                Ok(())
            } else {
                Err(probe_result.reason)
            }
        }
        Err(error) => {
            if let Some(stage) = task.stages.iter_mut().find(|s| s.key == probe_stage_key) {
                stage.status = if error.contains("超时") {
                    "timeout".to_string()
                } else {
                    "failed".to_string()
                };
                stage.message = Some(error.clone());
            }
            append_log(
                app,
                task,
                Some(probe_stage_key.to_string()),
                format!("启动探针检测异常：{}", error),
            );
            Err(error)
        }
    }
}

fn execute_single_step(
    app: &AppHandle,
    conn: &mut SshConnection,
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
    conn: &mut SshConnection,
    step: &DeployStep,
    context: &DeploymentContext,
    task_id: &str,
) -> AppResult<String> {
    let config: SshCommandConfig = parse_config(step)?;
    let run_post_stop_cleanup = is_stop_process_step(&step.name, &config.command);
    let command_template = normalize_legacy_builtin_command(&step.name, &config.command);
    let mut command = expand_tokens(&command_template, context);
    if let Some(timeout) = step.timeout_seconds.filter(|value| *value > 0) {
        command = format!("timeout {} sh -lc {}", timeout, shell_quote(&command));
    }
    let result = conn.execute_allowing_status(
        &command,
        config.success_exit_codes.as_deref().unwrap_or(&[0]),
        || is_cancel_requested(app, task_id),
    )?;
    let exit_status = result.exit_status;
    let mut output = result.output;
    if run_post_stop_cleanup {
        let cleanup_template = stop_port_owner_fragment("${portProbePort}");
        let cleanup_command = expand_tokens(&cleanup_template, context);
        match conn.execute_with_cancel(&cleanup_command, || is_cancel_requested(app, task_id)) {
            Ok(cleanup_result) => {
                if !cleanup_result.output.trim().is_empty() {
                    if !output.is_empty() {
                        output.push('\n');
                    }
                    output.push_str(cleanup_result.output.trim());
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(if output.is_empty() {
        format!("{} 执行完成，退出码 {}", step.name, exit_status)
    } else {
        format!("{} 输出：{}", step.name, output)
    })
}

fn is_stop_process_step(step_name: &str, command: &str) -> bool {
    let lower_name = step_name.to_ascii_lowercase();
    let looks_like_stop_step = step_name.contains("停止")
        || step_name.contains("停服")
        || lower_name.contains("stop")
        || lower_name.contains("shutdown");
    let touches_pid_or_process = command.contains("${pidFile}")
        || command.contains(".pid")
        || command.contains("PID_FILE")
        || command.contains("pkill")
        || command.contains("kill");
    looks_like_stop_step && touches_pid_or_process
}

fn normalize_legacy_builtin_command(step_name: &str, command: &str) -> String {
    if command.contains("APP_NAME=\"${remoteArtifactName%.*}\"")
        && command.contains("DEPLOY_LOG=\"$LOG_DIR/$APP_NAME-$(date +%Y%m%d%H%M%S).log\"")
        && command.contains("nohup java -jar")
    {
        return standard_start_command();
    }

    if command.contains("APP_NAME=\"${remoteArtifactName%.*}\"")
        && command.contains("PID_FILE=\"${remoteDeployPath}/$APP_NAME.pid\"")
        && command.contains("pkill -f \"${remoteArtifactName}\"")
    {
        return standard_stop_command();
    }

    if command.contains("PID_FILE=\"${pidFile}\"")
        && command.contains("pkill -f")
        && (command.contains("${remoteArtifactName}")
            || command.contains("${remoteDeployPath}/${remoteArtifactName}"))
        && !command.contains("find_port_pids")
    {
        return standard_stop_command();
    }

    if command.contains("PID_FILE=\"${pidFile}\"")
        && command.contains("find_port_pids")
        && !command.contains("端口清理检查")
    {
        return standard_stop_command();
    }

    if is_stop_process_step(step_name, command) && !command.contains("端口 Java 进程清理") {
        return standard_stop_command();
    }

    command.to_string()
}

fn standard_stop_command() -> String {
    stop_service_command(
        "\"${pidFile}\"",
        "\"${remoteDeployPath}/${remoteArtifactName}\"",
        &stop_port_owner_fragment("${portProbePort}"),
    )
}

fn standard_start_command() -> String {
    "mkdir -p \"${logDir}\" && cd \"${serviceDir}\" || exit 1; nohup \"${javaBin}\" ${jvmOptions} -jar \"${remoteDeployPath}/${remoteArtifactName}\" ${springProfile} ${extraArgs} > \"${logFile}\" 2>&1 & PID=$!; echo \"$PID\" > \"${pidFile}\"; echo \"${logFile}\" > \"${logPathFile}\"; sleep 1; if ! ps -p \"$PID\" > /dev/null 2>&1; then echo \"服务进程启动后立即退出\"; tail -n 80 \"${logFile}\" 2>/dev/null || true; exit 1; fi; echo \"PID=$PID; LOG_FILE=${logFile}\"".to_string()
}

fn stop_port_check_fragment(port: Option<u16>) -> String {
    let Some(port) = port else {
        return String::new();
    };
    stop_port_owner_fragment(&port.to_string())
}

fn stop_service_command(pid_file: &str, artifact_pattern: &str, port_fragment: &str) -> String {
    format!(
        "PID_FILE={pid_file}; if [ -f \"$PID_FILE\" ]; then PID=$(cat \"$PID_FILE\"); if [ -n \"$PID\" ]; then echo \"====== 停止服务进程 PID=$PID\"; kill -9 \"$PID\" 2>/dev/null || true; fi; rm -f \"$PID_FILE\"; fi; pkill -9 -f {artifact_pattern} 2>/dev/null || true; {port_fragment}",
        pid_file = pid_file,
        artifact_pattern = artifact_pattern,
        port_fragment = port_fragment,
    )
}

fn stop_port_owner_fragment(port: &str) -> String {
    format!(
        "DEPLOY_PORT=\"{port}\"; if [ -z \"$DEPLOY_PORT\" ]; then LOG_FILE=\"\"; if [ -f \"${{logPathFile}}\" ]; then LOG_FILE=$(cat \"${{logPathFile}}\" 2>/dev/null || true); fi; if [ -z \"$LOG_FILE\" ]; then LOG_FILE=\"${{logFile}}\"; fi; if [ -f \"$LOG_FILE\" ]; then DEPLOY_PORT=$(grep -Eo 'port\\(s\\): [0-9]+|Port [0-9]+|server.port[ =:]+[0-9]+' \"$LOG_FILE\" 2>/dev/null | grep -Eo '[0-9]+' | tail -n 1); fi; fi; if [ -n \"$DEPLOY_PORT\" ]; then echo \"端口 Java 进程清理：$DEPLOY_PORT\"; find_port_pids() {{ if command -v lsof >/dev/null 2>&1; then lsof -nP -t -iTCP:$DEPLOY_PORT -sTCP:LISTEN 2>/dev/null; elif command -v ss >/dev/null 2>&1; then ss -ltnp 2>/dev/null | awk -v p=\":$DEPLOY_PORT\" '$4 ~ p\"$\" {{print}}' | grep -o 'pid=[0-9]*' | cut -d= -f2; elif command -v fuser >/dev/null 2>&1; then fuser -n tcp \"$DEPLOY_PORT\" 2>/dev/null; else PORT_HEX=$(printf '%04X' \"$DEPLOY_PORT\"); INODES=$(awk -v p=\":$PORT_HEX\" '$4==\"0A\" && toupper($2) ~ p\"$\" {{gsub(/\\r/,\"\",$10); print $10}}' /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u); for inode in $INODES; do for fd in /proc/[0-9]*/fd/*; do link=$(readlink \"$fd\" 2>/dev/null || true); if [ \"$link\" = \"socket:[$inode]\" ]; then pid=${{fd#/proc/}}; echo \"${{pid%%/*}}\"; fi; done; done; fi; }}; java_port_pids() {{ for pid in $(find_port_pids | tr ' ' '\\n' | sed '/^$/d' | sort -u); do CMD=$(tr '\\0' ' ' < \"/proc/$pid/cmdline\" 2>/dev/null || ps -p \"$pid\" -o args= 2>/dev/null || true); COMM=$(cat \"/proc/$pid/comm\" 2>/dev/null || true); if echo \"$COMM $CMD\" | grep -qi 'java'; then echo \"$pid\"; else echo \"端口 $DEPLOY_PORT 被非 Java 进程 PID $pid 占用，跳过查杀\" >&2; fi; done; }}; JAVA_PIDS=$(java_port_pids | tr ' ' '\\n' | sed '/^$/d' | sort -u | tr '\\n' ' '); if [ -n \"$JAVA_PIDS\" ]; then echo \"端口 $DEPLOY_PORT 被 Java PID $JAVA_PIDS 占用，直接查杀\"; kill $JAVA_PIDS 2>/dev/null || true; sleep 2; fi; JAVA_PIDS=$(java_port_pids | tr ' ' '\\n' | sed '/^$/d' | sort -u | tr '\\n' ' '); if [ -n \"$JAVA_PIDS\" ]; then echo \"端口 $DEPLOY_PORT Java PID $JAVA_PIDS 仍存活，强制查杀\"; kill -9 $JAVA_PIDS 2>/dev/null || true; sleep 1; fi; REMAINING=$(find_port_pids | tr ' ' '\\n' | sed '/^$/d' | sort -u | tr '\\n' ' '); if [ -n \"$REMAINING\" ]; then echo \"端口 $DEPLOY_PORT 仍被 PID $REMAINING 占用，无法启动新服务\"; exit 1; fi; else echo \"未解析到部署端口，跳过端口占用处理\"; fi",
        port = port
    )
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
    conn: &mut SshConnection,
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
    Err(to_user_error(format!(
        "端口检测超时：{}:{}",
        host, config.port
    )))
}

fn execute_http_check_step(
    app: &AppHandle,
    conn: &mut SshConnection,
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
            Some(format!(
                "第 {} 次 HTTP 检查，已等待 {} 秒",
                attempts,
                started.elapsed().as_secs()
            )),
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
    Err(to_user_error(format!(
        "HTTP 健康检查超时：{}；{}",
        url, last_error
    )))
}

fn execute_log_check_step(
    app: &AppHandle,
    conn: &mut SshConnection,
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
            Some(format!(
                "第 {} 次日志检测，已等待 {} 秒",
                attempts,
                started.elapsed().as_secs()
            )),
        );
        emit_task_update(app, task);
        let command = format!("tail -n 500 {} 2>/dev/null || true", shell_quote(&log_path));
        let result = conn.execute_with_cancel(&command, || is_cancel_requested(app, task_id))?;
        let content = result.output;
        if let Some(keyword) = config.failure_keywords.as_ref().and_then(|items| {
            items
                .iter()
                .find(|keyword| content.contains(keyword.as_str()))
        }) {
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
    conn: &mut SshConnection,
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
    conn.execute_with_cancel(&format!("mkdir -p {}", shell_quote(parent_dir)), || {
        is_cancel_requested(app, task_id)
    })?;
    if !config.overwrite {
        let exists_command = format!("test ! -e {}", shell_quote(&remote_path));
        conn.execute_with_cancel(&exists_command, || is_cancel_requested(app, task_id))
            .map_err(|_| to_user_error(format!("远程文件已存在且未允许覆盖：{}", remote_path)))?;
    }

    let mut last_emit_percent: f64 = -100.0;
    let mut last_emit_time = Instant::now();
    let step_id = step.id.clone();
    conn.upload_file_with_progress(
        local,
        &remote_path,
        || is_cancel_requested(app, task_id),
        |uploaded, total, speed_bps| {
            let percent = if total == 0 {
                100.0
            } else {
                ((uploaded as f64) * 100.0 / total as f64).min(100.0)
            };
            let now = Instant::now();
            let should_emit = percent >= 100.0
                || percent - last_emit_percent >= 2.0
                || now.duration_since(last_emit_time) >= Duration::from_millis(200);
            if should_emit {
                last_emit_percent = percent;
                last_emit_time = now;
                let speed_text = speed_bps
                    .map(|s| format!(", {}", format_speed(s)))
                    .unwrap_or_default();
                let message = format!(
                    "上传进度 {:.0}% ({}/{}){}",
                    percent,
                    format_bytes(uploaded),
                    format_bytes(total),
                    speed_text
                );
                update_stage(task, &step_id, "running", Some(message.clone()));
                let _ = app.emit(
                    "deployment_upload_progress",
                    UploadProgressEvent {
                        task_id: task_id.to_string(),
                        stage_key: step_id.clone(),
                        percent,
                        uploaded_bytes: uploaded,
                        total_bytes: total,
                        speed_bytes_per_second: speed_bps.map(|s| s as u64),
                        message,
                    },
                );
            }
        },
    )?;
    Ok(format!("文件已上传到 {}", remote_path))
}

fn run_remote_http_check(
    app: &AppHandle,
    conn: &mut SshConnection,
    config: &HttpCheckConfig,
    url: &str,
    task_id: &str,
) -> Result<(u16, String), String> {
    let method = config
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
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
    steps.sort_by(|left, right| {
        left.order
            .cmp(&right.order)
            .then(left.name.cmp(&right.name))
    });
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
    let target_path = format!(
        "{}/{}",
        context.remote_deploy_path, context.remote_artifact_name
    );
    let base_name = context
        .remote_artifact_name
        .rsplit_once('.')
        .map(|(n, _)| n)
        .unwrap_or(&context.remote_artifact_name);
    let pid_file = format!("{}/{}.pid", context.remote_deploy_path, base_name);
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let log_file = resolve_log_file(context, base_name, &today, &timestamp);
    let log_dir = log_file
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string())
        .unwrap_or_else(|| format!("{}/logs", context.remote_deploy_path));
    let log_path_file = format!("{}/{}.log.path", context.remote_deploy_path, base_name);
    let java_bin = context.java_bin_path.as_deref().unwrap_or("java");
    let jvm_opts = context.jvm_options.as_deref().unwrap_or("");
    let profile_arg = match &context.spring_profile {
        Some(p) if !p.trim().is_empty() => format!(" --spring.profiles.active={}", p),
        _ => String::new(),
    };
    let extra = match &context.extra_args {
        Some(e) if !e.trim().is_empty() => format!(" {}", e),
        _ => String::new(),
    };
    let service_dir = context
        .working_dir
        .as_deref()
        .unwrap_or(&context.remote_deploy_path);
    let start_command = if context.enable_deploy_log {
        format!(
            "mkdir -p {log_dir} && cd {app_dir} || exit 1; nohup {java_bin} {jvm_opts} -jar {jar_path}{profile_arg}{extra} > {log_file} 2>&1 & PID=$!; echo \"$PID\" > {pid_file} && echo {log_file_var} > {log_path_file}; sleep 1; if ! ps -p \"$PID\" > /dev/null 2>&1; then echo \"服务进程启动后立即退出\"; tail -n 80 {log_file} 2>/dev/null || true; exit 1; fi; echo PID=$(cat {pid_file}) && echo LOG_FILE=$(cat {log_path_file})",
            log_dir = shell_quote(&log_dir),
            app_dir = shell_quote(service_dir),
            java_bin = shell_quote(java_bin),
            jvm_opts = jvm_opts,
            jar_path = shell_quote(&target_path),
            profile_arg = profile_arg,
            extra = extra,
            log_file = shell_quote(&log_file),
            pid_file = shell_quote(&pid_file),
            log_file_var = shell_quote(&log_file),
            log_path_file = shell_quote(&log_path_file),
        )
    } else {
        format!(
            "cd {app_dir} || exit 1; nohup {java_bin} {jvm_opts} -jar {jar_path}{profile_arg}{extra} > /dev/null 2>&1 & PID=$!; echo \"$PID\" > {pid_file}; sleep 1; if ! ps -p \"$PID\" > /dev/null 2>&1; then echo \"服务进程启动后立即退出\"; exit 1; fi; echo PID=$(cat {pid_file})",
            app_dir = shell_quote(service_dir),
            java_bin = shell_quote(java_bin),
            jvm_opts = jvm_opts,
            jar_path = shell_quote(&target_path),
            profile_arg = profile_arg,
            extra = extra,
            pid_file = shell_quote(&pid_file),
        )
    };
    let stop_command = stop_service_command(
        &shell_quote(&pid_file),
        &shell_quote(&target_path),
        &stop_port_check_fragment(context.port_probe_port),
    );
    let backup_dir = context
        .backup_config
        .backup_dir
        .as_deref()
        .unwrap_or(&context.remote_deploy_path);
    let backup_file = format!(
        "{}/{}.{}.bak",
        backup_dir,
        base_name,
        chrono::Local::now().format("%Y%m%d%H%M%S")
    );
    let backup_command = if context.backup_config.enabled {
        format!(
            "mkdir -p {backup_dir} && if [ -f {target} ]; then cp -f {target} {backup}; fi",
            backup_dir = shell_quote(backup_dir),
            target = shell_quote(&target_path),
            backup = shell_quote(&backup_file),
        )
    } else {
        format!(
            "if [ -f {target} ]; then cp -f {target} {target}.${{date}}; fi",
            target = shell_quote(&target_path),
        )
    };
    let retention = context.backup_config.retention_count.max(1);
    let retention_plus_one = retention + 1;
    let cleanup_command = if context.backup_config.enabled {
        let cleanup_dir = shell_quote(backup_dir);
        let cleanup_base = shell_quote(base_name);
        format!(
            "ls -1t {cleanup_dir}/{cleanup_base}.*.bak 2>/dev/null | tail -n +{retention_plus_one} | xargs -r rm -f",
            cleanup_dir = cleanup_dir,
            cleanup_base = cleanup_base,
            retention_plus_one = retention_plus_one,
        )
    } else {
        String::new()
    };
    let mut steps = vec![
        create_upload_step(
            "legacy-upload",
            "上传产物",
            10,
            "${artifactPath}",
            &temp_path,
        ),
        create_ssh_step("legacy-backup", "备份旧版本", 15, &backup_command),
        create_ssh_step("legacy-stop", "停止旧服务", 20, &stop_command),
        create_wait_step("legacy-wait", "等待端口释放", 25, 3),
        create_ssh_step(
            "legacy-replace",
            "替换文件",
            30,
            &format!(
                "mv -f {temp} {target}",
                temp = shell_quote(&temp_path),
                target = shell_quote(&target_path),
            ),
        ),
        create_ssh_step("legacy-start", "启动新服务", 40, &start_command),
    ];
    if context.backup_config.enabled && !cleanup_command.is_empty() {
        steps.push(create_ssh_step(
            "legacy-cleanup-backups",
            "清理旧备份",
            16,
            &cleanup_command,
        ));
    }
    let mut order = 50;
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
            create_ssh_step(
                &format!("legacy-{}", command.id),
                &command.name,
                order,
                &command.command,
            )
        });
    }
    steps
}

fn create_upload_step(
    id: &str,
    name: &str,
    order: i32,
    local_path: &str,
    remote_path: &str,
) -> DeployStep {
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
        name: if name.trim().is_empty() {
            "SSH 命令".to_string()
        } else {
            name.to_string()
        },
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

fn create_wait_step(id: &str, name: &str, order: i32, wait_seconds: u64) -> DeployStep {
    DeployStep {
        id: id.to_string(),
        enabled: true,
        name: name.to_string(),
        step_type: TYPE_WAIT.to_string(),
        order,
        timeout_seconds: None,
        retry_count: Some(0),
        retry_interval_seconds: Some(3),
        failure_strategy: Some(STRATEGY_STOP.to_string()),
        config: json!({
            "waitSeconds": wait_seconds,
        }),
    }
}

fn create_http_step(id: &str, name: &str, order: i32, url: &str) -> DeployStep {
    DeployStep {
        id: id.to_string(),
        enabled: true,
        name: if name.trim().is_empty() {
            "HTTP 健康检查".to_string()
        } else {
            name.to_string()
        },
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
        message: if step.enabled {
            None
        } else {
            Some("步骤已禁用，跳过。".to_string())
        },
        retry_count: step.retry_count,
        current_retry: Some(0),
        duration_ms: None,
        logs: Vec::new(),
        probe_statuses: Vec::new(),
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
        project_root: String::new(),
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
            probe_statuses: Vec::new(),
        }],
        created_at: now.clone(),
        finished_at: Some(now),
        startup_pid: None,
        startup_log_path: None,
        probe_result: None,
        backup_path: None,
        log_offset_before_start: None,
        rollback_result: None,
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

fn execute_rollback(
    app: &AppHandle,
    conn: &mut SshConnection,
    task: &mut DeploymentTask,
    context: &DeploymentContext,
) {
    let base_name = context
        .remote_artifact_name
        .rsplit_once('.')
        .map(|(n, _)| n)
        .unwrap_or(&context.remote_artifact_name);
    let target_path = format!(
        "{}/{}",
        context.remote_deploy_path, context.remote_artifact_name
    );
    let pid_file = format!("{}/{}.pid", context.remote_deploy_path, base_name);

    let mut rollback = RollbackResult {
        executed: true,
        success: Some(false),
        message: None,
        restored_backup_path: None,
        restarted_old_version: Some(false),
    };

    append_log(app, task, None, "=== 开始回滚 ===".to_string());

    let stop_cmd = stop_service_command(
        &shell_quote(&pid_file),
        &shell_quote(&target_path),
        &stop_port_check_fragment(context.port_probe_port),
    );
    match conn.execute_with_cancel(&stop_cmd, || false) {
        Ok(_) => append_log(app, task, None, "回滚：已停止新版本服务".to_string()),
        Err(e) => append_log(app, task, None, format!("回滚：停止新版本服务失败：{}", e)),
    }

    let backup_dir = context
        .backup_config
        .backup_dir
        .as_deref()
        .unwrap_or(&context.remote_deploy_path);
    let find_backup_cmd = format!(
        "ls -1t {backup_dir}/{base}.*.bak 2>/dev/null | head -1",
        backup_dir = shell_quote(backup_dir),
        base = shell_quote(base_name),
    );
    let backup_file = match conn.execute_with_cancel(&find_backup_cmd, || false) {
        Ok(result) => result.output.trim().to_string(),
        Err(_) => String::new(),
    };

    if !backup_file.is_empty() {
        let restore_cmd = format!(
            "cp -f {backup} {target}",
            backup = shell_quote(&backup_file),
            target = shell_quote(&target_path),
        );
        match conn.execute_with_cancel(&restore_cmd, || false) {
            Ok(_) => {
                append_log(
                    app,
                    task,
                    None,
                    format!("回滚：已从备份 {} 恢复旧版本", backup_file),
                );
                rollback.restored_backup_path = Some(backup_file.clone());
                rollback.success = Some(true);
            }
            Err(e) => {
                append_log(app, task, None, format!("回滚：恢复备份失败：{}", e));
                rollback.message = Some(format!("恢复备份失败：{}", e));
            }
        }
    } else {
        append_log(
            app,
            task,
            None,
            "回滚：未找到备份文件，无法恢复旧版本".to_string(),
        );
        rollback.message = Some("未找到备份文件".to_string());
    }

    if context.backup_config.restart_after_rollback && rollback.success == Some(true) {
        let log_dir = format!("{}/logs", context.remote_deploy_path);
        let log_file = format!(
            "{}/{}-rollback-$(date +%Y%m%d%H%M%S).log",
            log_dir, base_name
        );
        let log_path_file = format!("{}/{}.log.path", context.remote_deploy_path, base_name);
        let java_bin = context.java_bin_path.as_deref().unwrap_or("java");
        let jvm_opts = context.jvm_options.as_deref().unwrap_or("");
        let profile_arg = match &context.spring_profile {
            Some(p) if !p.trim().is_empty() => format!(" --spring.profiles.active={}", p),
            _ => String::new(),
        };
        let extra = match &context.extra_args {
            Some(e) if !e.trim().is_empty() => format!(" {}", e),
            _ => String::new(),
        };
        let service_dir = context
            .working_dir
            .as_deref()
            .unwrap_or(&context.remote_deploy_path);
        let restart_cmd = format!(
            "mkdir -p {log_dir} && cd {app_dir} || exit 1; nohup {java_bin} {jvm_opts} -jar {jar_path}{profile_arg}{extra} > {log_file} 2>&1 & PID=$!; echo \"$PID\" > {pid_file} && echo {log_file_var} > {log_path_file}; sleep 1; if ! ps -p \"$PID\" > /dev/null 2>&1; then echo \"回滚服务进程启动后立即退出\"; tail -n 80 {log_file} 2>/dev/null || true; exit 1; fi",
            log_dir = shell_quote(&log_dir),
            app_dir = shell_quote(service_dir),
            java_bin = shell_quote(java_bin),
            jvm_opts = jvm_opts,
            jar_path = shell_quote(&target_path),
            profile_arg = profile_arg,
            extra = extra,
            log_file = shell_quote(&log_file),
            pid_file = shell_quote(&pid_file),
            log_file_var = shell_quote(&log_file),
            log_path_file = shell_quote(&log_path_file),
        );
        match conn.execute_with_cancel(&restart_cmd, || false) {
            Ok(_) => {
                append_log(app, task, None, "回滚：已重新启动旧版本服务".to_string());
                rollback.restarted_old_version = Some(true);
            }
            Err(e) => {
                append_log(app, task, None, format!("回滚：重启旧版本失败：{}", e));
                rollback.restarted_old_version = Some(false);
            }
        }
    }

    append_log(app, task, None, "=== 回滚结束 ===".to_string());
    task.rollback_result = Some(rollback);
    emit_task_update(app, task);
}

fn update_stage(task: &mut DeploymentTask, stage_key: &str, status: &str, message: Option<String>) {
    if let Some(stage) = task.stages.iter_mut().find(|item| item.key == stage_key) {
        let now = Utc::now();
        if matches!(status, "running" | "checking" | "waiting") && stage.started_at.is_none() {
            stage.started_at = Some(now.to_rfc3339());
        }
        if matches!(
            status,
            "success" | "failed" | "skipped" | "cancelled" | "timeout"
        ) {
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

fn update_stage_retry(
    task: &mut DeploymentTask,
    stage_key: &str,
    current_retry: u32,
    retry_count: u32,
) {
    if let Some(stage) = task.stages.iter_mut().find(|item| item.key == stage_key) {
        stage.current_retry = Some(current_retry);
        stage.retry_count = Some(retry_count);
    }
}

fn append_log(app: &AppHandle, task: &mut DeploymentTask, stage_key: Option<String>, line: String) {
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
    let now = chrono::Local::now();
    let today = now.format("%Y%m%d").to_string();
    let timestamp = now.format("%Y%m%d%H%M%S").to_string();
    let java_bin = context.java_bin_path.as_deref().unwrap_or("java");
    let jvm_opts = context.jvm_options.as_deref().unwrap_or("");
    let profile_arg = match &context.spring_profile {
        Some(p) if !p.trim().is_empty() => format!("--spring.profiles.active={}", p),
        _ => String::new(),
    };
    let extra = context.extra_args.as_deref().unwrap_or("");
    let service_dir = context
        .working_dir
        .as_deref()
        .unwrap_or(&context.remote_deploy_path);
    let base_name = context
        .remote_artifact_name
        .rsplit_once('.')
        .map(|(n, _)| n)
        .unwrap_or(&context.remote_artifact_name);
    let log_name_resolved = resolve_log_name(context, base_name, &today);
    let log_file = resolve_log_file(context, base_name, &today, &timestamp);
    let log_dir = log_file
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or(&context.remote_deploy_path)
        .to_string();
    let pid_file = format!("{}/{}.pid", context.remote_deploy_path, base_name);
    let log_path_file = format!("{}/{}.log.path", context.remote_deploy_path, base_name);
    let port_probe_port = context
        .port_probe_port
        .map(|port| port.to_string())
        .unwrap_or_default();
    value
        .replace("${remoteArtifactName%.*}", base_name)
        .replace("${artifactName%.*}", artifact_base_name(context))
        .replace("${artifactPath}", &context.artifact_path)
        .replace("${artifactName}", &context.artifact_name)
        .replace("${remoteArtifactName}", &context.remote_artifact_name)
        .replace("${remoteArtifactBaseName}", base_name)
        .replace("${remoteDeployPath}", &context.remote_deploy_path)
        .replace("${date}", &today)
        .replace("${timestamp}", &timestamp)
        .replace("${logName}", &log_name_resolved)
        .replace("${logFile}", &log_file)
        .replace("${logDir}", &log_dir)
        .replace("${logPathFile}", &log_path_file)
        .replace("${javaBin}", java_bin)
        .replace("${jvmOptions}", jvm_opts)
        .replace("${springProfile}", &profile_arg)
        .replace("${extraArgs}", extra)
        .replace("${serviceDir}", service_dir)
        .replace("${pidFile}", &pid_file)
        .replace("${portProbePort}", &port_probe_port)
}

fn artifact_base_name(context: &DeploymentContext) -> &str {
    context
        .artifact_name
        .rsplit_once('.')
        .map(|(n, _)| n)
        .unwrap_or(&context.artifact_name)
}

fn resolve_log_name(context: &DeploymentContext, base_name: &str, today: &str) -> String {
    match context.log_naming_mode.as_str() {
        "fixed" => context
            .log_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(base_name)
            .to_string(),
        _ => format!("{}-{}", base_name, today),
    }
}

fn resolve_log_file(
    context: &DeploymentContext,
    base_name: &str,
    today: &str,
    timestamp: &str,
) -> String {
    if let Some(custom) = context
        .log_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let resolved = custom
            .replace("${remoteDeployPath}", &context.remote_deploy_path)
            .replace("${artifactName}", &context.artifact_name)
            .replace("${artifactName%.*}", artifact_base_name(context))
            .replace("${remoteArtifactName}", &context.remote_artifact_name)
            .replace("${remoteArtifactName%.*}", base_name)
            .replace("${remoteArtifactBaseName}", base_name)
            .replace("${date}", today)
            .replace("${timestamp}", timestamp)
            .replace("${logName}", &resolve_log_name(context, base_name, today));

        if is_explicit_log_file(&resolved) {
            return resolved;
        }

        return format!(
            "{}/{}.log",
            resolved.trim_end_matches('/'),
            resolve_log_name(context, base_name, today)
        );
    }

    format!(
        "{}/logs/{}.log",
        context.remote_deploy_path,
        resolve_log_name(context, base_name, today)
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

fn normalize_remote_dir(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn task_status_for_step(step_type: &str) -> &'static str {
    match step_type {
        TYPE_UPLOAD_FILE => "uploading",
        TYPE_PORT_CHECK | TYPE_HTTP_CHECK | TYPE_LOG_CHECK => "checking",
        TYPE_WAIT => "checking",
        "startup_probe" => "checking",
        _ => "starting",
    }
}

fn running_status_for_step(step_type: &str) -> &'static str {
    match step_type {
        TYPE_WAIT => "waiting",
        TYPE_PORT_CHECK | TYPE_HTTP_CHECK | TYPE_LOG_CHECK => "checking",
        "startup_probe" => "checking",
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
        "startup_probe" => "启动探针检测中".to_string(),
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

fn format_speed(bytes_per_sec: f64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    if bytes_per_sec >= MB {
        format!("{:.1} MB/s", bytes_per_sec / MB)
    } else if bytes_per_sec >= KB {
        format!("{:.1} KB/s", bytes_per_sec / KB)
    } else {
        format!("{:.0} B/s", bytes_per_sec)
    }
}
