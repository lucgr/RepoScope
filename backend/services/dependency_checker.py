import argparse
import json
import os
import subprocess
from collections import defaultdict
import re # For go.mod parsing from content

# Placeholder for language-specific parsers
# We will fill these in later

# --- Parsers ---

def parse_go_mod_via_cli(repo_path):
    """Parses Go dependencies from go.mod using 'go list' (requires Go CLI)."""
    dependencies = []
    try:
        cmd = ['go', 'list', '-m', '-json', 'all']
        result = subprocess.run(cmd, cwd=repo_path, capture_output=True, text=True, check=True, timeout=60)
        line_content_for_error = ""
        for line in result.stdout.strip().split('\n'):
            if line:
                line_content_for_error = line
                dep_info = json.loads(line)
                if dep_info.get('Version') and dep_info['Path'] != dep_info.get('Main', {}).get('Path'): # Exclude the main module itself
                    dependencies.append({'name': dep_info['Path'], 'version': dep_info['Version']})
    except FileNotFoundError:
        # print(f"Go command not found. Cannot use CLI parser for {repo_path}.") # More suitable for analyze_project
        raise RuntimeError(f"Go command not found. CLI parsing unavailable for {repo_path}.")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Go command timed out for {repo_path}.")
    except subprocess.CalledProcessError as e:
        # print(f"Error parsing Go dependencies via CLI for {repo_path}: {e}")
        # if e.stderr: print(f"Go list stderr: {e.stderr}")
        raise RuntimeError(f"Error parsing Go (CLI) for {repo_path}: {e.stderr or e.stdout or e}")
    except json.JSONDecodeError as e:
        # print(f"Error decoding JSON from 'go list' output for {repo_path}: {e}")
        # print(f"Problematic JSON string: {line_content_for_error}")
        raise RuntimeError(f"JSON decode error from 'go list' for {repo_path} on line: {line_content_for_error}")
    return dependencies

def parse_go_mod_from_content(go_mod_content):
    """Parses Go dependencies directly from go.mod file content using regex."""
    dependencies = []
    # Regex to find 'require' blocks and individual require lines
    # It captures module path and version. Handles comments and '// indirect'.
    # require_block_re = re.compile(r"require\s*\((.*?)\)", re.DOTALL)
    # single_require_re = re.compile(r"require\s+([^\s]+)\s+([^\s]+)(?:\s*//.*)?")
    # module_re = re.compile(r"([^\s]+)\s+([^\s]+)(?:\s*//.*)?") # Inside require block

    # Simpler regex: matches module path and version, tries to ignore comments
    # Example: `github.com/user/repo v1.2.3`
    # Example: `github.com/user/repo v1.2.3 // indirect`
    # Will not perfectly handle complex go.mod files with replace directives etc.
    # This is a best-effort parse if 'go list' is not available.
    
    # Regex for lines like: `path version` or `path version // comment`
    # It captures the path and the version.
    # It's tricky because paths can contain slashes and versions can contain dots/dashes.
    # We assume path does not contain whitespace, and version does not contain whitespace.
    dep_line_re = re.compile(r"^\s*([\w\.\-_/]+)\s+(v[\w\.\-_]+(?:/[\w\.\-_]+)*)\s*(?://.*)?$")

    in_require_block = False
    for line in go_mod_content.splitlines():
        line = line.strip()
        if not line or line.startswith("//"): # Skip empty lines and full-line comments
            continue

        if line.startswith("require ("):
            in_require_block = True
            continue
        if line.startswith("require") and not in_require_block: # Single line require
             # e.g. require example.com/mod v1.2.3
            parts = line.split()
            if len(parts) >= 3:
                path, version = parts[1], parts[2]
                if version.startswith("v"):
                     dependencies.append({'name': path, 'version': version})
            continue # End of single line require processing
        
        if in_require_block:
            if line == ")":
                in_require_block = False
                continue
            match = dep_line_re.match(line)
            if match:
                path, version = match.groups()
                dependencies.append({'name': path, 'version': version})
            # else:
                # print(f"Skipping unparsed line in require block: {line}")


    return dependencies


def parse_python_requirements_txt(requirements_content):
    """Parses Python dependencies from requirements.txt content."""
    dependencies = []
    for line in requirements_content.splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            # Remove inline comments
            line = line.split('#')[0].strip()
            if not line:
                continue

            if '==' in line:
                name, version = line.split('==', 1)
                dependencies.append({'name': name.strip(), 'version': version.strip()})
            elif any(op in line for op in ['>=', '<=', '~=', '!=', '<', '>']):
                name = line
                for specifier in ['>=', '<=', '~=', '!=', '==', '<', '>']: # Order matters for splitting
                    if specifier in name:
                        name = name.split(specifier)[0].strip()
                        break
                dependencies.append({'name': name, 'version': 'complex_specifier'})
            else: # Just package name (implies 'any' or could be a VCS link)
                dependencies.append({'name': line.strip(), 'version': 'any'})
    return dependencies

# --- Core Analysis Logic ---

def analyze_project_dependencies(project_id, project_type, file_content, use_go_cli=False, repo_path_for_cli=None):
    """
    Analyzes dependencies for a single project.
    Returns a list of dependencies or raises an error.
    """
    dependencies = []
    if project_type == 'go':
        if use_go_cli and repo_path_for_cli:
            # This path requires the 'go' command to be available in the execution environment
            dependencies = parse_go_mod_via_cli(repo_path_for_cli)
        else:
            dependencies = parse_go_mod_from_content(file_content)
    elif project_type == 'python':
        dependencies = parse_python_requirements_txt(file_content)
    else:
        raise ValueError(f"Unsupported project type: {project_type} for project {project_id}")
    return dependencies

def analyze_dependencies(projects_data, use_go_cli_if_available=False):
    """
    Analyzes dependencies across multiple projects and reports discrepancies.

    Args:
        projects_data: A list of dictionaries, where each dictionary is:
            {
                'id': 'unique_project_identifier',      // e.g., repository name
                'type': 'go' | 'python',               // project type
                'content': 'string_content_of_dependency_file',
                'path': '/optional/path/to/repo'      // Optional: For Go CLI parser if use_go_cli_if_available is True
            }
        use_go_cli_if_available (bool): If True, attempt to use 'go list' for Go projects if 'path' is provided.

    Returns:
        A dictionary with 'discrepancies' and 'errors'.
        Example:
        {
            'discrepancies': [
                {'dependency_name': 'libX', 'versions': [
                    {'project_id': 'projA', 'version': '1.0'},
                    {'project_id': 'projB', 'version': '1.1'}
                ]}
            ],
            'errors': [
                {'project_id': 'projC', 'error': 'Failed to parse'}
            ]
        }
    """
    all_project_dependencies = defaultdict(list) # {'dep_name': [{'version': 'x', 'project_id': 'id1'}, ...]}
    errors = []

    for project in projects_data:
        project_id = project.get('id', 'unknown_project')
        project_type = project.get('type')
        file_content = project.get('content')
        repo_path = project.get('path') # Used only if use_go_cli_if_available is True

        if not project_type or not file_content:
            errors.append({'project_id': project_id, 'error': 'Missing type or content.'})
            continue
        
        try:
            is_go_project = project_type == 'go'
            should_use_cli = is_go_project and use_go_cli_if_available and repo_path is not None
            
            parsed_deps = analyze_project_dependencies(project_id, project_type, file_content, 
                                                       use_go_cli=should_use_cli, repo_path_for_cli=repo_path)
            for dep in parsed_deps:
                all_project_dependencies[dep['name']].append({'version': dep['version'], 'project_id': project_id})
        except Exception as e:
            errors.append({'project_id': project_id, 'type': project_type, 'error': str(e)})

    discrepancies_report = []
    for dep_name, versions_info in all_project_dependencies.items():
        unique_versions = set(info['version'] for info in versions_info)
        if len(unique_versions) > 1:
            # Further filter: if all unique versions are 'any' or 'complex_specifier', maybe not a "hard" discrepancy.
            # For now, any difference is reported.
            discrepancies_report.append({
                'dependency_name': dep_name,
                'versions': versions_info # Contains all projects using this dep and their versions
            })
            
    return {'discrepancies': discrepancies_report, 'errors': errors}

# --- CLI main function (for local testing and standalone use) ---
def main():
    parser = argparse.ArgumentParser(
        description="Check for dependency version discrepancies across Go and Python projects."
    )
    parser.add_argument(
        "repo_paths", nargs='+', 
        help="List of paths to repository directories. The script will look for go.mod or requirements.txt."
    )
    parser.add_argument(
        "--use-go-cli", action="store_true",
        help="For Go projects, use 'go list -m -json all' for more accurate dependency resolution (requires Go CLI in PATH)."
    )
    
    args = parser.parse_args()
    
    projects_to_analyze = []
    
    for repo_path in args.repo_paths:
        if not os.path.isdir(repo_path):
            print(f"Warning: Path {repo_path} is not a valid directory. Skipping.")
            continue

        project_id = os.path.basename(repo_path)
        project_data = None

        go_mod_path = os.path.join(repo_path, 'go.mod')
        req_txt_path = os.path.join(repo_path, 'requirements.txt')

        if os.path.exists(go_mod_path):
            print(f"Found go.mod in {repo_path}, preparing Go project: {project_id}")
            try:
                with open(go_mod_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                projects_to_analyze.append({
                    'id': project_id, 
                    'type': 'go', 
                    'content': content,
                    'path': repo_path # For CLI parser if selected
                })
            except Exception as e:
                print(f"Error reading {go_mod_path}: {e}")
        elif os.path.exists(req_txt_path): # elif, so a repo isn't scanned twice if it has both (unlikely for distinct projects)
            print(f"Found requirements.txt in {repo_path}, preparing Python project: {project_id}")
            try:
                with open(req_txt_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                projects_to_analyze.append({
                    'id': project_id, 
                    'type': 'python', 
                    'content': content,
                    'path': repo_path # Not used by python parser, but consistent
                })
            except Exception as e:
                print(f"Error reading {req_txt_path}: {e}")
        else:
            print(f"No supported dependency file (go.mod, requirements.txt) found in {repo_path}. Skipping.")

    if not projects_to_analyze:
        print("No projects found to analyze.")
        return

    results = analyze_dependencies(projects_to_analyze, use_go_cli_if_available=args.use_go_cli)
    
    print("\n--- Dependency Discrepancy Report ---")
    if results['discrepancies']:
        for discrepancy in results['discrepancies']:
            print(f"Discrepancy for: {discrepancy['dependency_name']}")
            for version_info in discrepancy['versions']:
                print(f"  - Project: {version_info['project_id']}, Version: {version_info['version']}")
            print("-" * 20)
    else:
        print("No dependency version discrepancies found.")
        
    if results['errors']:
        print("\n--- Errors Encountered ---")
        for error in results['errors']:
            print(f"Project: {error['project_id']} (Type: {error.get('type', 'N/A')}) - Error: {error['error']}")

if __name__ == "__main__":
    main()

# --- Conceptual Flask App Example (Commented out) ---
"""
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/check_dependencies', methods=['POST'])
def check_dependencies_endpoint():
    data = request.get_json()
    if not data or 'projects' not in data:
        return jsonify({'error': 'Missing projects data in request body'}), 400
    
    projects_data = data['projects'] # Expects a list of project dicts as per analyze_dependencies
    
    # You might want to add a flag for 'use_go_cli_if_available' based on your backend env.
    # For a generic backend URL, it's safer to assume CLI is not available,
    # unless the backend is specifically designed to have it.
    results = analyze_dependencies(projects_data, use_go_cli_if_available=False) 
    
    return jsonify(results)

if __name__ == '__main__' and os.environ.get("RUN_FLASK_APP"): # Example: RUN_FLASK_APP=true python dependency_checker.py
    # This is so the script can still be run for CLI by default
    app.run(debug=True, port=5001) 
""" 