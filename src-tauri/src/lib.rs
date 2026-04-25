mod commands;
mod error;
mod models;
mod repositories;
mod services;

use services::deployment_executor::DeploymentControlState;
use services::process_runner::BuildProcessState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            services::app_logger::log_info(app.handle(), "app.start", "应用启动");
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(BuildProcessState::default())
        .manage(DeploymentControlState::default())
        .invoke_handler(tauri::generate_handler![
            commands::project::parse_maven_project,
            commands::project::analyze_project_dependencies,
            commands::environment::detect_environment,
            commands::environment::load_environment_settings,
            commands::environment::save_environment_settings,
            commands::environment::save_last_project_path,
            commands::environment::remove_saved_project_path,
            commands::build::build_command_preview,
            commands::build::start_build,
            commands::build::cancel_build,
            commands::filesystem::open_path_in_explorer,
            commands::filesystem::scan_build_artifacts,
            commands::filesystem::delete_build_artifact,
            commands::git::check_git_status,
            commands::git::fetch_git_updates,
            commands::git::pull_git_updates,
            commands::git::switch_git_branch,
            commands::git::list_git_commits,
            commands::history::list_build_history,
            commands::history::save_build_history,
            commands::template::list_templates,
            commands::template::save_template,
            commands::template::delete_template,
            commands::task_pipeline::list_task_pipelines,
            commands::task_pipeline::save_task_pipeline,
            commands::task_pipeline::delete_task_pipeline,
            commands::task_pipeline::list_task_pipeline_runs,
            commands::task_pipeline::start_task_pipeline,
            commands::deployment::list_server_profiles,
            commands::deployment::save_server_profile,
            commands::deployment::delete_server_profile,
            commands::deployment::list_deployment_profiles,
            commands::deployment::save_deployment_profile,
            commands::deployment::delete_deployment_profile,
            commands::deployment::list_deployment_tasks,
            commands::deployment::start_deployment,
            commands::deployment::cancel_deployment,
            commands::deployment::delete_deployment_task,
            commands::task_pipeline::delete_task_pipeline_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
