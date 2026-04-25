use crate::error::AppResult;
use crate::models::task_pipeline::{TaskPipeline, TaskPipelineRun};
use crate::repositories::storage::open_database;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

pub fn list_pipelines(app: &AppHandle) -> AppResult<Vec<TaskPipeline>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM task_pipelines ORDER BY updated_at DESC, name ASC")
        .map_err(|error| format!("无法读取任务模板：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取任务模板：{}", error))?;

    let mut pipelines = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取任务模板：{}", error))?;
        let pipeline = serde_json::from_str(&payload)
            .map_err(|error| format!("任务模板数据格式异常：{}", error))?;
        pipelines.push(pipeline);
    }

    Ok(pipelines)
}

pub fn save_pipeline(app: &AppHandle, mut pipeline: TaskPipeline) -> AppResult<()> {
    let connection = open_database(app)?;
    let now = Utc::now().to_rfc3339();
    let existing: Option<String> = connection
        .query_row(
            "SELECT created_at FROM task_pipelines WHERE id = ?1",
            params![pipeline.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("无法读取任务模板：{}", error))?;

    pipeline.created_at = existing.or_else(|| Some(now.clone()));
    pipeline.updated_at = Some(now);
    let payload = serde_json::to_string(&pipeline)
        .map_err(|error| format!("无法序列化任务模板：{}", error))?;

    connection
        .execute(
            r#"
            INSERT INTO task_pipelines (id, name, created_at, updated_at, payload)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload = excluded.payload
            "#,
            params![
                pipeline.id,
                pipeline.name,
                pipeline.created_at,
                pipeline.updated_at,
                payload
            ],
        )
        .map_err(|error| format!("无法保存任务模板：{}", error))?;

    Ok(())
}

pub fn delete_pipeline(app: &AppHandle, pipeline_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute("DELETE FROM task_pipelines WHERE id = ?1", params![pipeline_id])
        .map_err(|error| format!("无法删除任务模板：{}", error))?;
    Ok(())
}

pub fn list_pipeline_runs(app: &AppHandle) -> AppResult<Vec<TaskPipelineRun>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM task_pipeline_runs ORDER BY started_at DESC")
        .map_err(|error| format!("无法读取任务执行历史：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取任务执行历史：{}", error))?;

    let mut runs = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取任务执行历史：{}", error))?;
        let run = serde_json::from_str(&payload)
            .map_err(|error| format!("任务执行历史数据格式异常：{}", error))?;
        runs.push(run);
    }
    Ok(runs)
}

pub fn delete_pipeline_run(app: &AppHandle, run_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute("DELETE FROM task_pipeline_runs WHERE id = ?1", params![run_id])
        .map_err(|error| format!("无法删除任务执行记录：{}", error))?;
    Ok(())
}

pub fn save_pipeline_run(app: &AppHandle, run: TaskPipelineRun) -> AppResult<()> {
    let connection = open_database(app)?;
    let payload = serde_json::to_string(&run)
        .map_err(|error| format!("无法序列化任务执行历史：{}", error))?;
    connection
        .execute(
            r#"
            INSERT INTO task_pipeline_runs (id, pipeline_id, started_at, payload)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                pipeline_id = excluded.pipeline_id,
                started_at = excluded.started_at,
                payload = excluded.payload
            "#,
            params![run.id, run.pipeline_id, run.started_at, payload],
        )
        .map_err(|error| format!("无法保存任务执行历史：{}", error))?;

    connection
        .execute(
            r#"
            DELETE FROM task_pipeline_runs
            WHERE id NOT IN (
                SELECT id FROM task_pipeline_runs
                ORDER BY started_at DESC
                LIMIT 100
            )
            "#,
            [],
        )
        .map_err(|error| format!("无法清理任务执行历史：{}", error))?;

    Ok(())
}
