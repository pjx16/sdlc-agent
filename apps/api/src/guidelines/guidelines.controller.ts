import { Body, Controller, Get, HttpCode, HttpStatus, OnModuleInit, Param, Post, Put } from '@nestjs/common';
import { type CatalogueEntry, GuidelinesService, type TreeNode, wildcardToPath } from './guidelines.service';

@Controller('guidelines')
export class GuidelinesController implements OnModuleInit {
  constructor(private readonly guidelines: GuidelinesService) {}

  async onModuleInit(): Promise<void> {
    await this.guidelines.onInit();
  }

  /** The editable files as a tree. The guidelines page uses the catalogue instead. */
  @Get()
  tree(): Promise<TreeNode[]> {
    return this.guidelines.editableTree();
  }

  /** What the guidelines page shows: every item, whether it was changed from what shipped, and when. Before the wildcard routes. */
  @Get('catalogue')
  catalogue(): Promise<CatalogueEntry[]> {
    return this.guidelines.catalogue();
  }

  @Post('reset/*path')
  @HttpCode(HttpStatus.OK)
  reset(@Param('path') path: string | string[]) {
    return this.guidelines.reset(wildcardToPath(path));
  }

  @Get('*path')
  read(@Param('path') path: string | string[]) {
    return this.guidelines.readGuideline(wildcardToPath(path));
  }

  @Put('*path')
  write(@Param('path') path: string | string[], @Body() body: { content?: unknown }) {
    return this.guidelines.writeGuideline(wildcardToPath(path), body?.content);
  }
}
