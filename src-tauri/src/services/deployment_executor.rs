use crate::error::{to_user_error, AppResult};
use crate::models::deployment::{DeploymentCustomCommand, DeploymentStage, DeploymentTask, StartDeploymentPayload};
use crate::repositories::deployment_repo;
use crate::services::{health_check_service, ssh_transport_service::SshConnection};
use chrono::Utc;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const STAGE_UPLOAD: &str = "upload";
const STAGE_STOP: &str = "stop";
const STAGE_REPLACE: &str = "replace";
const STAGE_START: &str = "start";
const STAGE_HEALTH: &str = "health";

const PHASE_BEFORE_STOP: &str = "before_stop";
const PHASE_AFTER_STOP: &str = "after_stop";
const PHASE_AFTER_REPLACE: &str = "after_replace";
const PHASE_AFTER_START: &str = "after_start";
const PHASE_AFTER_HEALTH: &str = "after_health";

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

    let started_at = Utc::now().to_rfc3339();
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
        artifact_name: artifact_name.clone(),
        status: "pending".to_string(),
        log: Vec::new(),
        stages: vec![
            create_stage(STAGE_UPLOAD, "上传产物"),
            create_stage(STAGE_STOP, "停止旧服务"),
            create_stage(STAGE_REPLACE, "替换文件"),
            create_stage(STAGE_START, "启动服务"),
            create_stage(STAGE_HEALTH, "健康检查"),
        ],
        created_at: started_at,
        finished_at: None,
    };

    // Open SSH connection once, reuse for all operations
    append_log(app, &mut task, None, format!("连接到 {}:{}", server.host, server.port));
    task.status = "uploading".to_string();
    emit_task_update(app, &task);

    let conn = match SshConnection::connect(&server) {
        Ok(conn) => {
            append_log(app, &mut task, None, "SSH 连接建立成功".to_string());
            emit_task_update(app, &task);
            conn
        }
        Err(error) => {
            fail_stage(app, &mut task, STAGE_UPLOAD, error.clone());
            return Ok(task);
        }
    };

    let remote_deploy_path = normalize_remote_dir(&profile.remote_deploy_path);
    let remote_temp_path = format!("{}/.{}.uploading", remote_deploy_path, artifact_name);
    let remote_target_path = format!("{}/{}", remote_deploy_path, artifact_name);

    if finish_if_cancelled(app, &mut task, STAGE_UPLOAD) {
        return Ok(task);
    }

    update_stage(&mut task, STAGE_UPLOAD, "running", Some("上传进度 0%".to_string()));
    emit_task_update(app, &task);
    if let Err(error) = conn.execute_with_cancel(
        &format!("mkdir -p {}", shell_quote(&remote_deploy_path)),
        || is_cancel_requested(app, task_id),
    ) {
        fail_stage(app, &mut task, STAGE_UPLOAD, error);
        return Ok(task);
    }
    if finish_if_cancelled(app, &mut task, STAGE_UPLOAD) {
        return Ok(task);
    }

    let mut last_upload_percent = 0_u64;
    let upload_result = conn.upload_file_with_progress(
        artifact_path,
        &remote_temp_path,
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
                    &mut task,
                    STAGE_UPLOAD,
                    "running",
                    Some(format!("上传进度 {}% ({}/{})", percent, format_bytes(uploaded), format_bytes(total))),
                );
                emit_task_update(app, &task);
            }
        },
    );
    if let Err(error) = upload_result {
        if is_cancel_requested(app, task_id) {
            mark_cancelled(app, &mut task, STAGE_UPLOAD, "部署已停止。");
        } else {
            fail_stage(app, &mut task, STAGE_UPLOAD, error);
        }
        return Ok(task);
    }
    update_stage(
        &mut task,
        STAGE_UPLOAD,
        "success",
        Some(format!("产物已上传到 {}", remote_temp_path)),
    );
    append_log(app, &mut task, Some(STAGE_UPLOAD.to_string()), format!("产物已上传到 {}", remote_temp_path));
    emit_task_update(app, &task);

    // before_stop custom commands
    run_custom_commands(app, &conn, &mut task, &profile.custom_commands, PHASE_BEFORE_STOP, task_id);
    if task.status == "failed" || task.status == "cancelled" {
        return Ok(task);
    }

    task.status = "stopping".to_string();
    emit_task_update(app, &task);
    let stop_commands = collect_stage_commands(&profile.custom_commands, STAGE_STOP);
    if !stop_commands.is_empty() {
        if run_custom_command_stage(app, &conn, &mut task, STAGE_STOP, &stop_commands, task_id)
            .is_err()
        {
            return Ok(task);
        }
    } else {
        skip_stage(app, &mut task, STAGE_STOP, "停止命令未配置，跳过。");
    }

    // after_stop custom commands
    run_custom_commands(app, &conn, &mut task, &profile.custom_commands, PHASE_AFTER_STOP, task_id);
    if task.status == "failed" || task.status == "cancelled" {
        return Ok(task);
    }

    if run_stage(app, &mut task, STAGE_REPLACE, || {
        let command = format!(
            "mkdir -p {dir} && mv -f {temp} {target}",
            dir = shell_quote(&remote_deploy_path),
            temp = shell_quote(&remote_temp_path),
            target = shell_quote(&remote_target_path)
        );
        let result = conn.execute_with_cancel(&command, || {
            is_cancel_requested(app, task_id)
        })?;
        Ok(if result.output.is_empty() {
            format!("已替换远端文件 {}", remote_target_path)
        } else {
            result.output
        })
    })
    .is_err()
    {
        return Ok(task);
    }

    // after_replace custom commands
    run_custom_commands(app, &conn, &mut task, &profile.custom_commands, PHASE_AFTER_REPLACE, task_id);
    if task.status == "failed" || task.status == "cancelled" {
        return Ok(task);
    }

    task.status = "starting".to_string();
    emit_task_update(app, &task);
    let start_commands = collect_stage_commands(&profile.custom_commands, STAGE_START);
    if !start_commands.is_empty() {
        if run_custom_command_stage(app, &conn, &mut task, STAGE_START, &start_commands, task_id)
            .is_err()
        {
            return Ok(task);
        }
    } else {
        skip_stage(app, &mut task, STAGE_START, "启动命令未配置，跳过。");
    }

    // after_start custom commands
    run_custom_commands(app, &conn, &mut task, &profile.custom_commands, PHASE_AFTER_START, task_id);
    if task.status == "failed" || task.status == "cancelled" {
        return Ok(task);
    }

    task.status = "checking".to_string();
    emit_task_update(app, &task);
    let health_commands = collect_stage_commands(&profile.custom_commands, STAGE_HEALTH);
    if !health_commands.is_empty() {
        if run_custom_command_stage(app, &conn, &mut task, STAGE_HEALTH, &health_commands, task_id)
            .is_err()
        {
            return Ok(task);
        }
    } else {
        skip_stage(app, &mut task, STAGE_HEALTH, "健康检查未配置，跳过。");
    }

    // after_health custom commands
    run_custom_commands(app, &conn, &mut task, &profile.custom_commands, PHASE_AFTER_HEALTH, task_id);
    if task.status == "failed" || task.status == "cancelled" {
        return Ok(task);
    }

    task.status = "success".to_string();
    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(
        app,
        &mut task,
        None,
        format!("部署完成，总耗时 {} ms", started.elapsed().as_millis()),
    );
    emit_task_update(app, &task);
    Ok(task)
}

fn create_stage(key: &str, label: &str) -> DeploymentStage {
    DeploymentStage {
        key: key.to_string(),
        label: label.to_string(),
        status: "pending".to_string(),
        started_at: None,
        finished_at: None,
        message: None,
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
    let mut stages = vec![
        create_stage(STAGE_UPLOAD, "上传产物"),
        create_stage(STAGE_STOP, "停止旧服务"),
        create_stage(STAGE_REPLACE, "替换文件"),
        create_stage(STAGE_START, "启动服务"),
        create_stage(STAGE_HEALTH, "健康检查"),
    ];
    if let Some(stage) = stages.first_mut() {
        stage.status = "failed".to_string();
        stage.message = Some(error.clone());
        stage.started_at = Some(now.clone());
        stage.finished_at = Some(now.clone());
    }

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
        log: vec![error],
        stages,
        created_at: now.clone(),
        finished_at: Some(now),
    }
}

fn run_stage<F>(
    app: &AppHandle,
    task: &mut DeploymentTask,
    stage_key: &str,
    action: F,
) -> AppResult<()>
where
    F: FnOnce() -> AppResult<String>,
{
    if finish_if_cancelled(app, task, stage_key) {
        return Err(to_user_error("部署已停止。"));
    }

    update_stage(task, stage_key, "running", None);
    emit_task_update(app, task);
    match action() {
        Ok(message) => {
            update_stage(task, stage_key, "success", Some(message.clone()));
            append_log(app, task, Some(stage_key.to_string()), message);
            emit_task_update(app, task);
            Ok(())
        }
        Err(error) => {
            if is_cancel_requested(app, &task.id) {
                mark_cancelled(app, task, stage_key, "部署已停止。");
            } else {
                fail_stage(app, task, stage_key, error.clone());
            }
            Err(error)
        }
    }
}

fn fail_stage(app: &AppHandle, task: &mut DeploymentTask, stage_key: &str, error: String) {
    update_stage(task, stage_key, "failed", Some(error.clone()));
    task.status = "failed".to_string();
    task.finished_at = Some(Utc::now().to_rfc3339());
    append_log(app, task, Some(stage_key.to_string()), error);
    emit_task_update(app, task);
}

fn mark_cancelled(app: &AppHandle, task: &mut DeploymentTask, stage_key: &str, message: &str) {
    update_stage(task, stage_key, "cancelled", Some(message.to_string()));
    mark_pending_stages_skipped(task);
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

fn mark_pending_stages_skipped(task: &mut DeploymentTask) {
    for stage in &mut task.stages {
        if stage.status == "pending" {
            stage.status = "skipped".to_string();
            stage.message = Some("部署已停止，跳过。".to_string());
            stage.finished_at = Some(Utc::now().to_rfc3339());
        }
    }
}

fn skip_stage(app: &AppHandle, task: &mut DeploymentTask, stage_key: &str, message: &str) {
    update_stage(task, stage_key, "skipped", Some(message.to_string()));
    append_log(app, task, Some(stage_key.to_string()), message.to_string());
    emit_task_update(app, task);
}

fn update_stage(task: &mut DeploymentTask, stage_key: &str, status: &str, message: Option<String>) {
    if let Some(stage) = task.stages.iter_mut().find(|item| item.key == stage_key) {
        if status == "running" {
            stage.started_at = Some(Utc::now().to_rfc3339());
        }
        if matches!(status, "success" | "failed" | "skipped" | "cancelled") {
            stage.finished_at = Some(Utc::now().to_rfc3339());
        }
        stage.status = status.to_string();
        stage.message = message;
    }
}

fn append_log(
    app: &AppHandle,
    task: &mut DeploymentTask,
    stage_key: Option<String>,
    line: String,
) {
    task.log.push(line.clone());
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

fn normalize_remote_dir(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn collect_stage_commands<'a>(
    commands: &'a [DeploymentCustomCommand],
    stage: &str,
) -> Vec<&'a DeploymentCustomCommand> {
    commands
        .iter()
        .filter(|c| c.enabled && c.stage == stage && !c.command.trim().is_empty())
        .collect()
}

fn run_custom_command_stage(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    stage_key: &str,
    commands: &[&DeploymentCustomCommand],
    task_id: &str,
) -> AppResult<()> {
    if finish_if_cancelled(app, task, stage_key) {
        return Err(to_user_error("部署已停止。"));
    }
    update_stage(task, stage_key, "running", None);
    emit_task_update(app, task);

    for cmd in commands {
        if is_cancel_requested(app, task_id) {
            mark_cancelled(app, task, stage_key, "部署已停止。");
            return Err(to_user_error("部署已停止。"));
        }
        append_log(
            app,
            task,
            Some(stage_key.to_string()),
            format!("[{}] 执行: {}", cmd.name, cmd.command),
        );
        let result = if is_http_url(&cmd.command) {
            health_check_service::check_health(&cmd.command)
        } else {
            conn.execute_with_cancel(&cmd.command, || is_cancel_requested(app, task_id))
                .map(|r| {
                    if r.output.is_empty() {
                        format!("[{}] 执行完成", cmd.name)
                    } else {
                        format!("[{}] 输出: {}", cmd.name, r.output)
                    }
                })
        };
        match result {
            Ok(msg) => {
                append_log(app, task, Some(stage_key.to_string()), msg);
            }
            Err(error) => {
                if is_cancel_requested(app, task_id) {
                    mark_cancelled(app, task, stage_key, "部署已停止。");
                } else {
                    update_stage(task, stage_key, "failed", Some(error.clone()));
                    task.status = "failed".to_string();
                    task.finished_at = Some(Utc::now().to_rfc3339());
                    append_log(
                        app,
                        task,
                        Some(stage_key.to_string()),
                        format!("[{}] 执行失败: {}", cmd.name, error),
                    );
                    emit_task_update(app, task);
                }
                return Err(to_user_error(error));
            }
        }
    }

    update_stage(
        task,
        stage_key,
        "success",
        Some(format!("{} 条命令执行完成", commands.len())),
    );
    emit_task_update(app, task);
    Ok(())
}

fn run_custom_commands(
    app: &AppHandle,
    conn: &SshConnection,
    task: &mut DeploymentTask,
    commands: &[DeploymentCustomCommand],
    stage: &str,
    task_id: &str,
) {
    let to_run = collect_stage_commands(commands, stage);
    if to_run.is_empty() {
        return;
    }
    for cmd in to_run {
        if is_cancel_requested(app, task_id) {
            mark_cancelled(app, task, STAGE_REPLACE, "部署已停止。");
            return;
        }
        append_log(
            app,
            task,
            None,
            format!("[{}] 执行自定义命令: {}", cmd.name, cmd.command),
        );
        let result = if is_http_url(&cmd.command) {
            health_check_service::check_health(&cmd.command).map_err(|e| e.to_string())
        } else {
            conn.execute_with_cancel(&cmd.command, || is_cancel_requested(app, task_id))
                .map(|r| {
                    if r.output.is_empty() {
                        format!("[{}] 执行完成", cmd.name)
                    } else {
                        format!("[{}] 输出: {}", cmd.name, r.output)
                    }
                })
        };
        match result {
            Ok(msg) => {
                append_log(app, task, None, msg);
            }
            Err(error) => {
                if is_cancel_requested(app, task_id) {
                    mark_cancelled(app, task, STAGE_REPLACE, "部署已停止。");
                } else {
                    task.status = "failed".to_string();
                    task.finished_at = Some(Utc::now().to_rfc3339());
                    append_log(
                        app,
                        task,
                        None,
                        format!("[{}] 自定义命令执行失败: {}", cmd.name, error),
                    );
                }
                return;
            }
        }
    }
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
