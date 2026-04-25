use crate::error::AppResult;
use crate::models::deployment::{
    DeploymentProfile, DeploymentTask, SaveServerProfilePayload, ServerProfile, StartDeploymentPayload,
};
use crate::repositories::deployment_repo;
use crate::services::{app_logger, blocking, deployment_executor};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_server_profiles(app: AppHandle) -> AppResult<Vec<ServerProfile>> {
    let task_app = app.clone();
    let result = blocking::run(move || deployment_repo::list_server_profiles(&task_app)).await;
    match &result {
        Ok(items) => app_logger::log_info(
            &app,
            "deployment.server.list.success",
            format!("count={}", items.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "deployment.server.list.failed",
            format!("error={}", error),
        ),
    }
    result
}

#[tauri::command]
pub async fn save_server_profile(
    app: AppHandle,
    payload: SaveServerProfilePayload,
) -> AppResult<ServerProfile> {
    let task_app = app.clone();
    let result = blocking::run(move || deployment_repo::save_server_profile(&task_app, payload)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "deployment.server.save.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn delete_server_profile(app: AppHandle, server_id: String) -> AppResult<()> {
    let task_app = app.clone();
    let result = blocking::run(move || deployment_repo::delete_server_profile(&task_app, &server_id)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "deployment.server.delete.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn list_deployment_profiles(app: AppHandle) -> AppResult<Vec<DeploymentProfile>> {
    let task_app = app.clone();
    let result = blocking::run(move || deployment_repo::list_deployment_profiles(&task_app)).await;
    match &result {
        Ok(items) => app_logger::log_info(
            &app,
            "deployment.profile.list.success",
            format!("count={}", items.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "deployment.profile.list.failed",
            format!("error={}", error),
        ),
    }
    result
}

#[tauri::command]
pub async fn save_deployment_profile(
    app: AppHandle,
    profile: DeploymentProfile,
) -> AppResult<DeploymentProfile> {
    let task_app = app.clone();
    let result =
        blocking::run(move || deployment_repo::save_deployment_profile(&task_app, profile)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "deployment.profile.save.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn delete_deployment_profile(app: AppHandle, profile_id: String) -> AppResult<()> {
    let task_app = app.clone();
    let result =
        blocking::run(move || deployment_repo::delete_deployment_profile(&task_app, &profile_id))
            .await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "deployment.profile.delete.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn list_deployment_tasks(app: AppHandle) -> AppResult<Vec<DeploymentTask>> {
    let task_app = app.clone();
    let result = blocking::run(move || deployment_repo::list_deployment_tasks(&task_app)).await;
    match &result {
        Ok(items) => app_logger::log_info(
            &app,
            "deployment.history.success",
            format!("count={}", items.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "deployment.history.failed",
            format!("error={}", error),
        ),
    }
    result
}

#[tauri::command]
pub fn start_deployment(app: AppHandle, payload: StartDeploymentPayload) -> AppResult<String> {
    app_logger::log_info(
        &app,
        "deployment.start",
        format!("deployment_profile_id={}", payload.deployment_profile_id),
    );
    deployment_executor::start_deployment(app, payload)
}

#[tauri::command]
pub fn cancel_deployment(app: AppHandle, task_id: String) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "deployment.cancel",
        format!("task_id={}", task_id),
    );
    deployment_executor::cancel_deployment(app, task_id)
}

#[tauri::command]
pub async fn delete_deployment_task(app: AppHandle, task_id: String) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "deployment.task.delete.start",
        format!("task_id={}", task_id),
    );
    let task_app = app.clone();
    let result =
        blocking::run(move || deployment_repo::delete_deployment_task(&task_app, &task_id)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "deployment.task.delete.failed",
            format!("error={}", error),
        );
    }
    result
}
