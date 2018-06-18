/**
 * Copyright © Magento, Inc. All rights reserved.
 * See COPYING.txt for license details.
 */

import ContentTypeCollectionInterface from "../../content-type-collection.d";
import {outwardSearch} from "../../utils/array";
import ColumnPreview from "../column/preview";
import {ColumnWidth, GroupPositionCache, MaxGhostWidth, ResizeHistory} from "./preview";

export default class ColumnGroupUtils {
    private columnGroup: ContentTypeCollectionInterface;

    constructor(columnGroup: ContentTypeCollectionInterface) {
        this.columnGroup = columnGroup;
    }

    /**
     * Get the grid size for this columnGroup
     *
     * @returns {number}
     */
    public getGridSize(): number {
        const state = this.columnGroup.dataStore.get();
        return parseInt((state.gridSize as string), 10);
    }

    /**
     * Get the smallest column width possible
     *
     * @returns {number}
     */
    public getSmallestColumnWidth() {
        const gridSize = this.getGridSize();
        return this.getAcceptedColumnWidth(parseFloat((100 / gridSize).toString()).toFixed(
            Math.round(100 / gridSize) !== 100 / gridSize ? 8 : 0,
        ));
    }

    /**
     * Get an accepted column width to resolve rounding issues, e.g. turn 49.995% into 50%
     *
     * @param width
     * @returns {number}
     */
    public getAcceptedColumnWidth(width: string) {
        const gridSize = this.getGridSize();
        let newWidth = 0;
        for (let i = gridSize; i > 0; i--) {
            const percentage = parseFloat((100 / gridSize * i).toFixed(
                Math.round((100 / gridSize * i)) !== (100 / gridSize * i) ? 8 : 0,
            ));
            // Allow for rounding issues
            if (parseFloat(width) > (percentage - 0.1) && parseFloat(width) < (percentage + 0.1)) {
                newWidth = percentage;
                break;
            }
        }
        return newWidth;
    }

    /**
     * Return the width of the column
     *
     * @param {ContentTypeCollectionInterface} column
     * @returns {number}
     */
    public getColumnWidth(column: ContentTypeCollectionInterface): number {
        return this.getAcceptedColumnWidth(column.dataStore.get().width.toString());
    }

    /**
     * Retrieve the index of the column within it's group
     *
     * @param {ContentTypeCollectionInterface} column
     * @returns {number}
     */
    public getColumnIndexInGroup(column: ContentTypeCollectionInterface): number {
        return column.parent.children().indexOf(column);
    }

    /**
     * Retrieve the adjacent column based on a direction of +1 or -1
     *
     * @param {ContentTypeCollectionInterface} column
     * @param {"+1" | "-1"} direction
     * @returns {ContentTypeCollectionInterface}
     */
    public getAdjacentColumn(
        column: ContentTypeCollectionInterface, direction: "+1" | "-1",
    ): ContentTypeCollectionInterface {
        const currentIndex = this.getColumnIndexInGroup(column);
        if (typeof column.parent.children()[currentIndex + parseInt(direction, 10)] !== "undefined") {
            return column.parent.children()[currentIndex + parseInt(direction, 10)];
        }
        return null;
    }

    /**
     * Get the total width of all columns in the group
     *
     * @returns {number}
     */
    public getColumnsWidth(): number {
        return this.columnGroup.children().map((column: ContentTypeCollectionInterface) => {
            return this.getColumnWidth(column);
        }).reduce((widthA: number, widthB: number) => {
            return widthA + (widthB ? widthB : 0);
        });
    }

    /**
     * Determine the pixel position of every column that can be created within the group
     *
     * @param {ContentTypeCollectionInterface} column
     * @param {GroupPositionCache} groupPosition
     * @returns {ColumnWidth[]}
     */
    public determineColumnWidths(
        column: ContentTypeCollectionInterface,
        groupPosition: GroupPositionCache,
    ): ColumnWidth[] {
        const gridSize = this.getGridSize();
        const singleColumnWidth = groupPosition.outerWidth / gridSize;
        const adjacentColumn = this.getAdjacentColumn(column, "+1");
        const columnWidths = [];
        const columnLeft = (column.preview as ColumnPreview).element.offset().left
            - parseInt((column.preview as ColumnPreview).element.css("margin-left"), 10);
        const adjacentRightPosition = (adjacentColumn.preview as ColumnPreview).element.offset().left +
            (adjacentColumn.preview as ColumnPreview).element.outerWidth(true);

        // Determine the maximum size (in pixels) that this column can be dragged to
        const columnsToRight = column.parent.children().length - (this.getColumnIndexInGroup(column) + 1);
        const leftMaxWidthFromChildren = groupPosition.left + groupPosition.outerWidth -
            (columnsToRight * singleColumnWidth) + 10;
        const rightMaxWidthFromChildren = groupPosition.left +
            (column.parent.children().length - columnsToRight) * singleColumnWidth - 10;
        // Due to rounding we add a threshold of 10

        // Iterate through the amount of columns generating the position for both left & right interactions
        for (let i = gridSize; i > 0; i--) {
            const position = Math.round(columnLeft + (singleColumnWidth * i));
            if (position > Math.round(leftMaxWidthFromChildren)) {
                continue;
            }
            columnWidths.push(
                {
                    forColumn: "left", // These positions are for the left column in the pair
                    name: i + "/" + gridSize,
                    position,
                    width: this.getRoundedColumnWidth(100 / gridSize * i),
                },
            );
        }

        for (let i = 1; i < gridSize; i++) {
            const position = Math.floor(adjacentRightPosition - (i * singleColumnWidth));
            if (position < Math.floor(rightMaxWidthFromChildren)) {
                continue;
            }
            // The right interaction is only used when we're crushing a column that isn't adjacent
            columnWidths.push(
                {
                    forColumn: "right", // These positions are for the left column in the pair
                    name: i + "/" + gridSize,
                    position,
                    width: this.getRoundedColumnWidth(100 / gridSize * i),
                },
            );
        }

        return columnWidths;
    }

    /**
     * Determine the max ghost width based on the calculated columns
     *
     * @param {ColumnWidth[]} columnWidths
     * @returns {MaxGhostWidth}
     */
    public determineMaxGhostWidth(columnWidths: ColumnWidth[]): MaxGhostWidth {
        const leftColumns = columnWidths.filter((width) => {
            return width.forColumn === "left";
        });
        const rightColumns = columnWidths.filter((width) => {
            return width.forColumn === "right";
        });
        return {
            left: leftColumns[0].position,
            right: rightColumns[rightColumns.length - 1].position,
        };
    }

    /**
     * Find a column which can be shrunk for the current resize action
     *
     * @param {ContentTypeCollectionInterface} column
     * @param {"left" | "right"} direction
     * @returns {ContentTypeCollectionInterface}
     */
    public findShrinkableColumnForResize(
        column: ContentTypeCollectionInterface,
        direction: "left" | "right",
    ): ContentTypeCollectionInterface {
        const currentIndex = this.getColumnIndexInGroup(column);
        const parentChildren = column.parent.children();
        let searchArray: ContentTypeCollectionInterface[];
        switch (direction) {
            case "right":
                searchArray = parentChildren.slice(currentIndex + 1);
                break;
            case "left":
                searchArray = parentChildren.slice(0).reverse().slice(parentChildren.length - currentIndex);
                break;
        }
        return searchArray.find((groupColumn: ContentTypeCollectionInterface) => {
            return this.getColumnWidth(groupColumn) > this.getSmallestColumnWidth();
        });
    }

    /**
     * Find a shrinkable column outwards from the current column
     *
     * @param {ContentTypeCollectionInterface} column
     * @returns {ContentTypeCollectionInterface}
     */
    public findShrinkableColumn(column: ContentTypeCollectionInterface): ContentTypeCollectionInterface {
        return outwardSearch(
            column.parent.children(),
            this.getColumnIndexInGroup(column),
            (neighbourColumn) => {
                return this.getColumnWidth(neighbourColumn) > this.getSmallestColumnWidth();
            },
        );
    }

    /**
     * Return the column width to 8 decimal places if it's not a whole number
     *
     * @param {number} width
     * @returns {string}
     */
    public getRoundedColumnWidth(width: number): number {
        return Number((width).toFixed(
            Math.round(width) !== width ? 8 : 0,
        ));
    }

    /**
     * Calculate the ghost size for the resizing action
     *
     * @param {GroupPositionCache} groupPosition
     * @param {number} currentPos
     * @param {ContentTypeCollectionInterface} column
     * @param {string} modifyColumnInPair
     * @param {MaxGhostWidth} maxGhostWidth
     * @returns {number}
     */
    public calculateGhostWidth(
        groupPosition: GroupPositionCache,
        currentPos: number,
        column: ContentTypeCollectionInterface,
        modifyColumnInPair: string,
        maxGhostWidth: MaxGhostWidth,
    ): number {
        let ghostWidth = currentPos - groupPosition.left;

        switch (modifyColumnInPair) {
            case "left":
                const singleColumnWidth = (column.preview as ColumnPreview).element.position().left
                    + groupPosition.outerWidth / this.getGridSize();
                // Don't allow the ghost widths be less than the smallest column
                if (ghostWidth <= singleColumnWidth) {
                    ghostWidth = singleColumnWidth;
                }

                if (currentPos >= maxGhostWidth.left) {
                    ghostWidth = maxGhostWidth.left - groupPosition.left;
                }
                break;
            case "right":
                if (currentPos <= maxGhostWidth.right) {
                    ghostWidth = maxGhostWidth.right - groupPosition.left;
                }
                break;
        }

        return ghostWidth;
    }

    /**
     * Determine which column in the group should be adjusted for the current resize action
     *
     * @param {number} currentPos
     * @param {ContentTypeCollectionInterface} column
     * @param {ResizeHistory} history
     * @returns {[ContentTypeCollectionInterface , string]}
     */
    public determineAdjustedColumn(
        currentPos: number,
        column: ContentTypeCollectionInterface,
        history: ResizeHistory,
    ): [ContentTypeCollectionInterface, string, string] {
        let modifyColumnInPair: string = "left";
        let usedHistory: string;
        const resizeColumnLeft = (column.preview as ColumnPreview).element.offset().left
            - parseInt((column.preview as ColumnPreview).element.css("margin-left"), 10);
        const resizeColumnWidth = (column.preview as ColumnPreview).element.outerWidth(true);
        const resizeHandlePosition = resizeColumnLeft + resizeColumnWidth;

        let adjustedColumn: ContentTypeCollectionInterface;
        if (currentPos >= resizeHandlePosition) {
            // Get the history for the opposite direction of resizing
            if (history.left.length > 0) {
                usedHistory = "left";
                adjustedColumn = history.left.reverse()[0].adjustedColumn;
                modifyColumnInPair = history.left.reverse()[0].modifyColumnInPair;
            } else {
                // If we're increasing the width of our column we need to locate a column that can shrink to the
                // right
                adjustedColumn = this.findShrinkableColumnForResize(column, "right");
            }
        } else {
            if (this.getColumnWidth(column) <= this.getSmallestColumnWidth()) {
                adjustedColumn = this.findShrinkableColumnForResize(column, "left");
                if (adjustedColumn) {
                    modifyColumnInPair = "right";
                }
            } else if (history.right.length > 0) {
                usedHistory = "right";
                adjustedColumn = history.right.reverse()[0].adjustedColumn;
                modifyColumnInPair = history.right.reverse()[0].modifyColumnInPair;
            } else {
                // If we're shrinking our column we can just increase the adjacent column
                adjustedColumn = this.getAdjacentColumn(column, "+1");
            }
        }

        return [adjustedColumn, modifyColumnInPair, usedHistory];
    }

    /**
     * Compare if two numbers are within a certain threshold of each other
     *
     * comparator(10,11,2) => true
     * comparator(1.1,1.11,0.5) => true
     *
     * @param {number} num1
     * @param {number} num2
     * @param {number} threshold
     * @returns {boolean}
     */
    public comparator(num1: number, num2: number, threshold: number): boolean {
        return (num1 > (num2 - (threshold / 2)) && num1 < (num2 + (threshold / 2)));
    }

    /**
     * Resize a column to a specific width
     *
     * @param {ContentTypeCollectionInterface} column
     * @param {number} width
     * @param {ContentTypeCollectionInterface} shrinkableColumn
     */
    public resizeColumn(
        column: ContentTypeCollectionInterface,
        width: number,
        shrinkableColumn: ContentTypeCollectionInterface,
    ) {
        const current = this.getColumnWidth(column);
        const difference = (parseFloat(width.toString()) - current).toFixed(8);

        // Don't run the update if we've already modified the column
        if (current === parseFloat(width.toString()) || parseFloat(width.toString()) < this.getSmallestColumnWidth()) {
            return;
        }

        // Also shrink the closest shrinkable column
        let allowedToShrink = true;
        if (difference && shrinkableColumn) {
            const currentShrinkable = this.getColumnWidth(shrinkableColumn);
            const shrinkableSize = this.getAcceptedColumnWidth((currentShrinkable + -difference).toString());

            // Ensure the column we're crushing is not becoming the same size, and it's not less than the smallest width
            if (currentShrinkable === parseFloat(shrinkableSize.toString())
                || parseFloat(shrinkableSize.toString()) < this.getSmallestColumnWidth()
            ) {
                allowedToShrink = false;
            } else {
                this.updateColumnWidth(
                    shrinkableColumn,
                    shrinkableSize,
                );
            }
        }

        if (allowedToShrink) {
            this.updateColumnWidth(column, width);
        }
    }

    /**
     * Update the width of a column
     *
     * @param {ContentTypeCollectionInterface} column
     * @param {number} width
     */
    public updateColumnWidth(column: ContentTypeCollectionInterface, width: number): void {
        column.dataStore.update(
            parseFloat(width.toString()) + "%",
            "width",
        );
    }
}
