/**
 * BoundingBox value object - Represents a rectangular region in an image/frame
 */

export class BoundingBox {
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;

  constructor(x: number, y: number, width: number, height: number) {
    if (width < 0 || height < 0) {
      throw new Error('Width and height must be non-negative');
    }
    this._x = x;
    this._y = y;
    this._width = width;
    this._height = height;
  }

  static fromCoordinates(x1: number, y1: number, x2: number, y2: number): BoundingBox {
    return new BoundingBox(x1, y1, x2 - x1, y2 - y1);
  }

  static fromCenter(centerX: number, centerY: number, width: number, height: number): BoundingBox {
    return new BoundingBox(centerX - width / 2, centerY - height / 2, width, height);
  }

  get x(): number {
    return this._x;
  }

  get y(): number {
    return this._y;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get x2(): number {
    return this._x + this._width;
  }

  get y2(): number {
    return this._y + this._height;
  }

  get centerX(): number {
    return this._x + this._width / 2;
  }

  get centerY(): number {
    return this._y + this._height / 2;
  }

  get area(): number {
    return this._width * this._height;
  }

  intersects(other: BoundingBox): boolean {
    // Edges count as intersecting: OCR boxes that share a border overlap
    // visually, and callers use this to merge lines into blocks.
    return (
      this._x <= other._x + other._width &&
      this._x + this._width >= other._x &&
      this._y <= other._y + other._height &&
      this._y + this._height >= other._y
    );
  }

  contains(other: BoundingBox): boolean {
    return (
      this._x <= other._x &&
      this._y <= other._y &&
      this._x + this._width >= other._x + other._width &&
      this._y + this._height >= other._y + other._height
    );
  }

  intersection(other: BoundingBox): BoundingBox | null {
    const x1 = Math.max(this._x, other._x);
    const y1 = Math.max(this._y, other._y);
    const x2 = Math.min(this._x + this._width, other._x + other._width);
    const y2 = Math.min(this._y + this._height, other._y + other._height);

    if (x1 >= x2 || y1 >= y2) {
      return null;
    }

    return BoundingBox.fromCoordinates(x1, y1, x2, y2);
  }

  union(other: BoundingBox): BoundingBox {
    const x1 = Math.min(this._x, other._x);
    const y1 = Math.min(this._y, other._y);
    const x2 = Math.max(this._x + this._width, other._x + other._width);
    const y2 = Math.max(this._y + this._height, other._y + other._height);

    return BoundingBox.fromCoordinates(x1, y1, x2, y2);
  }

  expand(padding: number): BoundingBox {
    return new BoundingBox(
      this._x - padding,
      this._y - padding,
      this._width + padding * 2,
      this._height + padding * 2
    );
  }

  scale(factor: number): BoundingBox {
    return new BoundingBox(
      this._x * factor,
      this._y * factor,
      this._width * factor,
      this._height * factor
    );
  }

  toString(): string {
    return `(${this._x}, ${this._y}, ${this._width}, ${this._height})`;
  }

  toJSON(): { x: number; y: number; width: number; height: number } {
    return {
      x: this._x,
      y: this._y,
      width: this._width,
      height: this._height
    };
  }

  equals(other: BoundingBox): boolean {
    return (
      this._x === other._x &&
      this._y === other._y &&
      this._width === other._width &&
      this._height === other._height
    );
  }
}