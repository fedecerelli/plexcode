import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as AdmZip from 'adm-zip';
import simpleGit from 'simple-git';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.createAdvancedFile', async () => {
        // Obtener configuración personalizada
        const config = vscode.workspace.getConfiguration('plexcode');
        const defaultFormat = config.get<string>('defaultFormat', '.txt');
        const autoCompress = config.get<boolean>('autoCompress', false);
        const showAttribution = config.get<boolean>('showAttribution', true);
        const useIcons = config.get<boolean>('showIcons', true);

        // Selección de archivos o directorios
        const options = await vscode.window.showQuickPick(
            [
                `${useIcons ? '📄 ' : ''}Archivos`,
                `${useIcons ? '📂 ' : ''}Directorios`
            ],
            { placeHolder: '¿Qué deseas combinar?', canPickMany: false }
        );

        let files: vscode.Uri[] = [];
        if (options?.includes('Archivos')) {
            const selectedFiles = await vscode.window.showOpenDialog({
                canSelectMany: true,
                openLabel: 'Seleccionar archivos',
                filters: {
                    'Archivos HTML': ['html'],  // Filtro para archivos HTML
                    'Todos los archivos soportados': ['html', 'js', 'py', 'ts', 'java', 'c', 'cpp', 'txt', 'md', 'css', 'json', 'xml', 'php', 'rb', 'go', 'rs'],
                    'Archivos de texto': ['txt', 'md']
                }
            });

            files = selectedFiles || [];
        } else if (options?.includes('Directorios')) {
            const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, openLabel: 'Seleccionar carpeta' });
            if (folder) {
                files = getFilesFromDirectory(folder[0].fsPath);
            }
        }

        if (files.length === 0) {
            vscode.window.showErrorMessage('⚠️ No se seleccionaron archivos.');
            return;
        }

        // Depuración: Mostrar archivos seleccionados
        console.log('Archivos seleccionados:', files.map(file => file.fsPath));

        // Selección de tipo de archivo para filtro de lenguaje
        const languageFilter = await vscode.window.showQuickPick(
            ['Todos', 'HTML', 'CSS', 'JavaScript', 'Python', 'Otros'],
            { placeHolder: 'Selecciona el tipo de archivo que deseas combinar' }
        );

        // Filtrar archivos según la selección del usuario
        files = files.filter(file => {
            if (languageFilter === 'HTML' && file.fsPath.toLowerCase().endsWith('.html')) return true;
            if (languageFilter === 'CSS' && file.fsPath.endsWith('.css')) return true;
            if (languageFilter === 'JavaScript' && file.fsPath.endsWith('.js')) return true;
            if (languageFilter === 'Python' && file.fsPath.endsWith('.py')) return true;
            if (languageFilter === 'Todos') return true;
            if (languageFilter === 'Otros') return true; // Incluir todos los demás archivos
            return false;
        });

        if (files.length === 0) {
            vscode.window.showErrorMessage('⚠️ No se encontraron archivos que coincidan con el filtro.');
            return;
        }

        // Selección de formato de salida
        const format = await vscode.window.showQuickPick(
            ['.txt', '.md', '.html', '.json'],
            { placeHolder: 'Selecciona el formato de salida', canPickMany: false }
        ) || defaultFormat;

        // Pedir nombre del archivo de salida
        const fileName = await vscode.window.showInputBox({ prompt: 'Introduce el nombre del archivo (sin extensión)' });
        if (!fileName) {
            vscode.window.showErrorMessage('⚠️ No se introdujo un nombre de archivo.');
            return;
        }

        // Generar contenido combinado y metadatos
        let fileContent = '';
        let metadata = '| Archivo | Tamaño (bytes) | Líneas |\n|---------|----------------|--------|\n';
        let totalSize = 0;
        let totalLines = 0;

        for (const file of files) {
            const filePath = file.fsPath;
            const fileData = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath);

            // Personalizar manejo para ciertos lenguajes
            if (fileName.toLowerCase().endsWith('.html')) {
                fileContent += `<div style="border: 1px solid #ccc; padding: 10px;">\n<!-- ${fileName} -->\n${fileData}\n</div>\n`;
            } else if (fileName.endsWith('.css')) {
                fileContent += `/* Contenido de ${fileName} */\n${fileData}\n\n`;
            } else {
                // Comportamiento por defecto
                fileContent += `## ${fileName}\n\n${fileData}\n\n`;
            }

            // Actualizar metadatos
            const fileSize = fs.statSync(filePath).size;
            const lineCount = fileData.split('\n').length;
            metadata += `| ${fileName} | ${fileSize} | ${lineCount} |\n`;
            totalSize += fileSize;
            totalLines += lineCount;
        }

        // Atributo especial "Desarrollado por"
        if (showAttribution) {
            fileContent += '\n\n---\n✨ Desarrollado por Plexcel.py\n';
        }

        if (format === '.md') {
            fileContent = metadata + '\n\n' + fileContent;
        }

        // Previsualización
        const preview = await vscode.window.showQuickPick(['Sí', 'No'], { placeHolder: '¿Previsualizar antes de guardar?' });
        if (preview === 'Sí') {
            vscode.workspace.openTextDocument({ content: fileContent }).then(doc => vscode.window.showTextDocument(doc));
        }

        // Guardar archivo combinado
        const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspacePath) {
            vscode.window.showErrorMessage('⚠️ No hay una carpeta abierta en el espacio de trabajo.');
            return;
        }

        const finalFilePath = path.join(workspacePath, `${fileName}${format}`);
        fs.writeFileSync(finalFilePath, fileContent, 'utf-8');
        vscode.window.showInformationMessage(`✨ Archivo creado: ${finalFilePath}`);

        // Comprimir archivo si está activado
        if (autoCompress || (await vscode.window.showQuickPick(['Sí', 'No'], { placeHolder: '¿Comprimir archivo?' })) === 'Sí') {
            const zip = new AdmZip();
            zip.addLocalFile(finalFilePath);
            const zipFilePath = path.join(workspacePath, `${fileName}.zip`);
            zip.writeZip(zipFilePath);
            vscode.window.showInformationMessage(`📦 Archivo comprimido: ${zipFilePath}`);
        }

        // Commit automático con Git si es un repositorio
        if (fs.existsSync(path.join(workspacePath, '.git'))) {
            const git = simpleGit(workspacePath);
            await git.add(finalFilePath);
            await git.commit(`Agregado: ${fileName}${format} (Desarrollado por Plexcel.py)`);
            vscode.window.showInformationMessage('✅ Archivo añadido a Git y commit realizado.');
        }

        vscode.window.showInformationMessage('Comando ejecutado correctamente.');
    });

    context.subscriptions.push(disposable);
}

// Función recursiva para obtener archivos desde un directorio
function getFilesFromDirectory(dir: string): vscode.Uri[] {
    let files: vscode.Uri[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const itemPath = path.join(dir, item.name);
        if (item.isFile()) {
            files.push(vscode.Uri.file(itemPath));
        } else if (item.isDirectory()) {
            files.push(...getFilesFromDirectory(itemPath));
        }
    }
    return files;
}

export function deactivate() {}
