require('dotenv').config();

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { mkdirp } = require('mkdirp');

console.log('开始同步 Notion 到 Hexo...');

// 用于生成安全文件名的辅助函数
function generateSafeFileName(name) {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '-');
}

// 格式化日期为 YYYY-MM-DD 格式
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: '2022-06-28'
});

// 记录每篇文章的图片序号
const imageCounter = new Map();

async function syncNotionToHexo() {
    try {
        // 1. 获取文章列表
        const response = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: {
                property: 'Published',
                checkbox: {
                    equals: true
                }
            }
        });

        if (!response.results || response.results.length === 0) {
            console.log('没有找到已发布的文章');
            return;
        }

        // 2. 处理每篇文章
        for (const post of response.results) {
            try {
                const title = post.properties.Title?.title[0]?.plain_text || 'Untitled';
                const dateObj = post.properties.Date?.date?.start
                    ? new Date(post.properties.Date.date.start)
                    : new Date();

                const formattedDate = formatDate(dateObj);
                const dateString = dateObj.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');


                // 提取Tags和Categories
                const tags = extractTags(post);
                const categories = extractCategories(post);

                const safeTitle = generateSafeFileName(title);
                const fileName = `${formattedDate}-${safeTitle}/index.md`;
                const postDirName = `${formattedDate}-${safeTitle}`;
                const postDir = path.join('source/_posts', postDirName);
                const filePath = path.join('source/_posts', fileName);

                imageCounter.set(post.id, 1);
                await mkdirp(postDir);

                // 获取文章内容块
                const blocks = await notion.blocks.children.list({
                    block_id: post.id
                });

                // 生成Markdown头部
                let content = `---
title: "${title}"
date: ${dateString}
tags: ${formatTagsOrCategories(tags)}
categories: ${formatTagsOrCategories(categories)}
---\n\n`;

                // 处理所有块
                for (const block of blocks.results) {
                    if (block.type === 'paragraph') {
                        content += block.paragraph.rich_text.map(t => t.plain_text).join('') + '\n\n';
                    } else if (block.type === 'heading_1') {
                        content += `# ${block.heading_1.rich_text.map(t => t.plain_text).join('')}\n\n`;
                    } else if (block.type === 'heading_2') {
                        content += `## ${block.heading_2.rich_text.map(t => t.plain_text).join('')}\n\n`;
                    } else if (block.type === 'heading_3') {
                        content += `### ${block.heading_3.rich_text.map(t => t.plain_text).join('')}\n\n`;
                    } else if (block.type === 'bulleted_list_item') {
                        content += `- ${block.bulleted_list_item.rich_text.map(t => t.plain_text).join('')}\n`;
                    } else if (block.type === 'numbered_list_item') {
                        content += `1. ${block.numbered_list_item.rich_text.map(t => t.plain_text).join('')}\n`;
                    } else if (block.type === 'image') {
                        // 处理图片
                        const imageUrl = getImageUrl(block);
                        if (imageUrl) {
                            const imageNum = imageCounter.get(post.id);
                            imageCounter.set(post.id, imageNum + 1);

                            const ext = path.extname(imageUrl.split('?')[0]) || '.jpg';
                            const imageName = `img${formattedDate}-${imageNum.toString().padStart(3, '0')}${ext}`;

                            await downloadImage(imageUrl, postDir, imageName);

                            // 合并所有 caption 文本
                            const captionText = (block.image.caption || [])
                                .map(t => t.plain_text)
                                .join('');

                            let customStyle = '';

                            const sizeMatch = captionText.match(/size\s*=\s*(\d+)%/i);
                            if (sizeMatch) {
                                customStyle += `width: ${sizeMatch[1]}%; height: auto;`;
                            } else {
                                customStyle += `max-width: 100%; height: auto;`;
                            }

                            if (/center/i.test(captionText)) {
                                customStyle += ` display: block; margin: 1rem auto;`;
                            } else if (/left/i.test(captionText)) {
                                customStyle += ` display: block; margin: 1rem 0 1rem 0;`;
                            } else if (/right/i.test(captionText)) {
                                customStyle += ` display: block; margin: 1rem 0 1rem auto;`;
                            } else {
                                customStyle += ` display: block; margin: 1rem auto;`;
                            }

                            content += `<img src="${postDirName}/${imageName}" alt="${imageName}" style="${customStyle}" />\n\n`;
                        }
                    }else if (block.type === 'quote') {
    content += `> ${block.quote.rich_text.map(t => t.plain_text).join('')}\n\n`;
}else if (block.type === 'callout') {
    // Notion 的 callout 有一个 icon 属性，这里简化处理，只提取文本
    content += `> [!NOTE]\n> ${block.callout.rich_text.map(t => t.plain_text).join('')}\n\n`;
}else if (block.type === 'divider') {
    content += `---\n\n`;
}else if (block.type === 'toggle') {
    content += `<details><summary>${block.toggle.rich_text.map(t => t.plain_text).join('')}</summary>\n\n`;
    // 这里需要递归获取并处理 toggle 内部的块
    // 考虑到复杂性，如果内容不深，可以暂时只获取顶层文本
     const children = await notion.blocks.children.list({ block_id: block.id });
     for (const childBlock of children.results) {
         // 递归处理子块，这会使代码复杂化，需要单独的函数
         // 为简洁起见，这里只做提示，具体实现需考虑
         if (childBlock.type === 'paragraph') {
             content += `  ${childBlock.paragraph.rich_text.map(t => t.plain_text).join('')}\n\n`;
         }
     }
    content += `</details>\n\n`;
}




                    // 代码块处理
                    else if (block.type === 'code') {
                        const codeBlock = block.code;
                        const language = codeBlock.language || '';
                        const codeContent = codeBlock.rich_text.map(t => t.plain_text).join('');
                        content += `\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
                    }
                    // 可继续添加更多块类型的处理
                }

                // 写入Markdown文件
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`成功生成: ${fileName} (目录: ${postDirName})`);

            } catch (error) {
                console.error(`处理文章时出错: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(`同步失败: ${error.message}`);
        process.exit(1);
    }
}

// 获取图片URL
function getImageUrl(block) {
    if (!block.image) return null;

    if (block.image.type === 'external') {
        return block.image.external.url;
    } else if (block.image.type === 'file') {
        return block.image.file.url;
    }

    return null;
}

// 下载图片到指定目录
async function downloadImage(url, dir, fileName) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(dir, fileName);
        const file = fs.createWriteStream(filePath);

        https.get(url, response => {
            if (response.statusCode !== 200) {
                reject(new Error(`下载图片失败，状态码: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve(fileName);
            });
        }).on('error', error => {
            fs.unlink(filePath, () => { });
            reject(error);
        });
    });
}

// 提取Tags的辅助函数
function extractTags(post) {
    const tagProperty = post.properties.Tags;
    if (!tagProperty || tagProperty.type !== 'multi_select') {
        return [];
    }
    return tagProperty.multi_select.map(option => option.name);
}

// 提取Categories的辅助函数
function extractCategories(post) {
    const categoryProperty = post.properties.Categories;
    if (!categoryProperty || categoryProperty.type !== 'select') {
        return [];
    }
    return categoryProperty.select ? [categoryProperty.select.name] : [];
}

// 格式化Tags或Categories为YAML数组格式
function formatTagsOrCategories(items) {
    if (!items || items.length === 0) {
        return '[]';
    }
    if (items.length === 1) {
        return `[${items[0]}]`;
    }
    return '[' + items.map(item => `"${item}"`).join(', ') + ']';
}

// 获取图片在Notion中的显示尺寸（基于block_width属性）
function getImageDisplaySize(block) {
    if (!block.image || !block.format) return null;

    // block.format.block_width 表示图片容器宽度占页面宽度的比例
    // 常见值：1（全宽）、0.6（中等）、0.3（小）
    const widthRatio = block.format?.block_width;

    if (widthRatio) {
        // 根据你的Hexo主题页面宽度调整这个值
        const baseWidth = 800;
        return {
            width: Math.round(baseWidth * widthRatio),
            // 不设置高度，让浏览器自动按比例缩放
        };
    }

    return null;
}

// 执行同步
syncNotionToHexo();