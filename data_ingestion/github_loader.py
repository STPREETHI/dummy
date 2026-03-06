"""
DevPilot - GitHub Repository Loader
Deep code analysis and documentation extraction from GitHub repositories.
"""
import os
import ast
import re
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from langchain.schema import Document

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")


class GitHubCodeAnalyzer:
    """
    Analyzes a cloned repository to extract:
    - Function/class docstrings
    - Module summaries
    - Dependency relationships
    - Architecture metadata
    """

    IGNORE_DIRS = {
        "node_modules", "__pycache__", ".git", ".venv", "venv",
        "dist", "build", ".next", "coverage", ".pytest_cache"
    }

    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)

    def analyze(self) -> List[Document]:
        """Full repository analysis returning enriched Documents."""
        docs = []
        docs.extend(self._load_docs())
        docs.extend(self._analyze_python_files())
        docs.extend(self._analyze_js_files())
        docs.extend(self._extract_readme())
        docs.extend(self._extract_config_context())
        return docs

    def _load_docs(self) -> List[Document]:
        """Load all markdown/text documentation."""
        docs = []
        for fp in self.repo_path.rglob("*.md"):
            if any(d in str(fp) for d in self.IGNORE_DIRS):
                continue
            try:
                content = fp.read_text(encoding="utf-8")
                docs.append(Document(
                    page_content=content,
                    metadata={
                        "source": str(fp.relative_to(self.repo_path)),
                        "source_type": "documentation",
                        "file_type": ".md",
                        "title": fp.stem.replace("_", " ").replace("-", " ").title()
                    }
                ))
            except Exception:
                pass
        return docs

    def _analyze_python_files(self) -> List[Document]:
        """Extract Python functions, classes, and their docstrings."""
        docs = []
        for fp in self.repo_path.rglob("*.py"):
            if any(d in str(fp) for d in self.IGNORE_DIRS):
                continue
            try:
                content = fp.read_text(encoding="utf-8")
                rel_path = str(fp.relative_to(self.repo_path))

                # Full file as code document
                docs.append(Document(
                    page_content=content,
                    metadata={
                        "source": rel_path,
                        "source_type": "code",
                        "language": "python",
                        "title": fp.name
                    }
                ))

                # Extract individual functions/classes with docstrings
                try:
                    tree = ast.parse(content)
                    for node in ast.walk(tree):
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                            docstring = ast.get_docstring(node) or ""
                            if docstring or len(ast.dump(node)) > 200:
                                kind = "class" if isinstance(node, ast.ClassDef) else "function"
                                snippet = ast.get_source_segment(content, node) or ""
                                docs.append(Document(
                                    page_content=f"# {kind}: {node.name}\n{docstring}\n\n{snippet[:600]}",
                                    metadata={
                                        "source": rel_path,
                                        "source_type": "code",
                                        "language": "python",
                                        "function_name": node.name,
                                        "kind": kind,
                                        "line_start": node.lineno,
                                        "title": f"{fp.name} → {node.name}"
                                    }
                                ))
                except SyntaxError:
                    pass
            except Exception:
                pass
        return docs

    def _analyze_js_files(self) -> List[Document]:
        """Load JavaScript/TypeScript files with basic extraction."""
        docs = []
        for ext in ("*.js", "*.ts", "*.jsx", "*.tsx"):
            for fp in self.repo_path.rglob(ext):
                if any(d in str(fp) for d in self.IGNORE_DIRS):
                    continue
                try:
                    content = fp.read_text(encoding="utf-8")
                    rel_path = str(fp.relative_to(self.repo_path))

                    # Extract JSDoc comments + function signatures
                    jsdoc_blocks = re.findall(
                        r'/\*\*[\s\S]*?\*/\s*(export\s+)?(async\s+)?function\s+\w+[^{]*',
                        content
                    )
                    enriched = "\n\n".join(jsdoc_blocks[:10]) if jsdoc_blocks else content[:1500]

                    docs.append(Document(
                        page_content=enriched,
                        metadata={
                            "source": rel_path,
                            "source_type": "code",
                            "language": "javascript",
                            "title": fp.name
                        }
                    ))
                except Exception:
                    pass
        return docs

    def _extract_readme(self) -> List[Document]:
        """Prioritize README as high-relevance overview document."""
        for name in ("README.md", "README.rst", "README.txt", "readme.md"):
            fp = self.repo_path / name
            if fp.exists():
                try:
                    content = fp.read_text(encoding="utf-8")
                    return [Document(
                        page_content=f"# Project Overview (README)\n\n{content}",
                        metadata={
                            "source": name,
                            "source_type": "documentation",
                            "priority": "high",
                            "title": "Project README"
                        }
                    )]
                except Exception:
                    pass
        return []

    def _extract_config_context(self) -> List[Document]:
        """Extract meaningful context from config files."""
        docs = []
        config_files = [
            "docker-compose.yml", "docker-compose.yaml",
            "requirements.txt", "package.json",
            ".env.example", "Makefile"
        ]
        for name in config_files:
            fp = self.repo_path / name
            if fp.exists():
                try:
                    content = fp.read_text(encoding="utf-8")
                    docs.append(Document(
                        page_content=f"# Configuration: {name}\n\n{content[:2000]}",
                        metadata={
                            "source": name,
                            "source_type": "documentation",
                            "title": f"Config: {name}"
                        }
                    ))
                except Exception:
                    pass
        return docs

    def get_module_map(self) -> Dict[str, List[str]]:
        """Return a module dependency map: {module: [imports]}."""
        module_map = {}
        for fp in self.repo_path.rglob("*.py"):
            if any(d in str(fp) for d in self.IGNORE_DIRS):
                continue
            try:
                content = fp.read_text(encoding="utf-8")
                imports = re.findall(r'^(?:from|import)\s+([\w.]+)', content, re.MULTILINE)
                rel = str(fp.relative_to(self.repo_path))
                module_map[rel] = list(set(imports))
            except Exception:
                pass
        return module_map

    def get_architecture_summary(self) -> str:
        """Generate a text summary of the repo architecture."""
        module_map = self.get_module_map()
        lines = ["# Architecture Overview\n"]

        top_dirs = set()
        for path in module_map.keys():
            parts = Path(path).parts
            if len(parts) > 1:
                top_dirs.add(parts[0])

        lines.append(f"## Top-Level Modules\n{', '.join(sorted(top_dirs))}\n")
        lines.append(f"## File Count\n{len(module_map)} Python files analyzed\n")

        # Most imported internal modules
        all_imports = []
        for imports in module_map.values():
            all_imports.extend(imports)

        from collections import Counter
        top_imports = Counter(all_imports).most_common(10)
        if top_imports:
            lines.append("## Most Referenced Modules")
            for mod, count in top_imports:
                lines.append(f"- `{mod}` — referenced {count} times")

        return "\n".join(lines)
