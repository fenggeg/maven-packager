use crate::error::AppResult;
use crate::models::task_pipeline::{StartTaskPipelinePayload, TaskPipeline, TaskPipelineRun};
use crate::repositories::pipeline_repo;
use crate::services::{app_logger, blocking, task_pipeline_executor};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_task_pipelines(app: AppHandle) -> AppResult<Vec<TaskPipeline>> {
    let task_app = app.clone();
    let result = blocking::run(move || pipeline_repo::list_pipelines(&task_app)).await;
    match &result {
        Ok(pipelines) => app_logger::log_info(
            &app,
            "task_pipeline.list.success",
            format!("count={}", pipelines.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "task_pipeline.list.failed",
            format!("error={}", error),
        ),
    }
    result
}

#[tauri::command]
pub async fn save_task_pipeline(app: AppHandle, pipeline: TaskPipeline) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "task_pipeline.save.start",
        format!("id={}, name={}", pipeline.id, pipeline.name),
    );
    let task_app = app.clone();
    let result = blocking::run(move || pipeline_repo::save_pipeline(&task_app, pipeline)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "task_pipeline.save.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn delete_task_pipeline(app: AppHandle, pipeline_id: String) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "task_pipeline.delete.start",
        format!("id={}", pipeline_id),
    );
    let task_app = app.clone();
    let result = blocking::run(move || pipeline_repo::delete_pipeline(&task_app, &pipeline_id)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "task_pipeline.delete.failed",
            format!("error={}", error),
        );
    }
    result
}

#[tauri::command]
pub async fn list_task_pipeline_runs(app: AppHandle) -> AppResult<Vec<TaskPipelineRun>> {
    let task_app = app.clone();
    let result = blocking::run(move || pipeline_repo::list_pipeline_runs(&task_app)).await;
    match &result {
        Ok(runs) => app_logger::log_info(
            &app,
            "task_pipeline.history.success",
            format!("count={}", runs.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "task_pipeline.history.failed",
            format!("error={}", error),
        ),
    }
    result
}

#[tauri::command]
pub fn start_task_pipeline(app: AppHandle, payload: StartTaskPipelinePayload) -> AppResult<String> {
    app_logger::log_info(
        &app,
        "task_pipeline.start",
        format!("pipeline_id={}, name={}", payload.pipeline.id, payload.pipeline.name),
    );
    task_pipeline_executor::start_pipeline(app, payload)
}

#[tauri::command]
pub async fn delete_task_pipeline_run(app: AppHandle, run_id: String) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "task_pipeline.run.delete.start",
        format!("run_id={}", run_id),
    );
    let task_app = app.clone();
    let result =
        blocking::run(move || pipeline_repo::delete_pipeline_run(&task_app, &run_id)).await;
    if let Err(error) = &result {
        app_logger::log_error(
            &app,
            "task_pipeline.run.delete.failed",
            format!("error={}", error),
        );
    }
    result
}
