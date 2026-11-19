import { describe, it, expect } from 'vitest';
import { BoundingBox } from '../../../src/domain/value-objects/BoundingBox';

describe('BoundingBox', () => {
  describe('constructor', () => {
    it('creates box with positive dimensions', () => {
      const box = new BoundingBox(10, 20, 100, 50);
      expect(box.x).toBe(10);
      expect(box.y).toBe(20);
      expect(box.width).toBe(100);
      expect(box.height).toBe(50);
    });

    it('throws on negative width', () => {
      expect(() => new BoundingBox(0, 0, -10, 50)).toThrow('Width and height must be non-negative');
    });

    it('throws on negative height', () => {
      expect(() => new BoundingBox(0, 0, 100, -50)).toThrow('Width and height must be non-negative');
    });
  });

  describe('static factories', () => {
    it('fromCoordinates creates correct box', () => {
      const box = BoundingBox.fromCoordinates(10, 20, 110, 70);
      expect(box.x).toBe(10);
      expect(box.y).toBe(20);
      expect(box.width).toBe(100);
      expect(box.height).toBe(50);
    });

    it('fromCenter creates correct box', () => {
      const box = BoundingBox.fromCenter(50, 50, 100, 50);
      expect(box.x).toBe(0);
      expect(box.y).toBe(25);
      expect(box.width).toBe(100);
      expect(box.height).toBe(50);
    });
  });

  describe('getters', () => {
    const box = new BoundingBox(10, 20, 100, 50);
    
    it('x2 returns right edge', () => {
      expect(box.x2).toBe(110);
    });

    it('y2 returns bottom edge', () => {
      expect(box.y2).toBe(70);
    });

    it('centerX returns center X', () => {
      expect(box.centerX).toBe(60);
    });

    it('centerY returns center Y', () => {
      expect(box.centerY).toBe(45);
    });

    it('area returns correct area', () => {
      expect(box.area).toBe(5000);
    });
  });

  describe('intersects', () => {
    it('returns true for overlapping boxes', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(50, 50, 100, 100);
      expect(box1.intersects(box2)).toBe(true);
    });

    it('returns false for non-overlapping boxes', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(200, 200, 100, 100);
      expect(box1.intersects(box2)).toBe(false);
    });

    it('returns true for touching edges', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(100, 0, 100, 100);
      expect(box1.intersects(box2)).toBe(true);
    });

    it('returns true for containment', () => {
      const box1 = new BoundingBox(0, 0, 200, 200);
      const box2 = new BoundingBox(50, 50, 100, 100);
      expect(box1.intersects(box2)).toBe(true);
    });
  });

  describe('contains', () => {
    it('returns true when box contains another', () => {
      const outer = new BoundingBox(0, 0, 200, 200);
      const inner = new BoundingBox(50, 50, 100, 100);
      expect(outer.contains(inner)).toBe(true);
    });

    it('returns false when box does not contain', () => {
      const outer = new BoundingBox(0, 0, 100, 100);
      const inner = new BoundingBox(50, 50, 100, 100);
      expect(outer.contains(inner)).toBe(false);
    });
  });

  describe('intersection', () => {
    it('returns intersection box', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(50, 50, 100, 100);
      const intersection = box1.intersection(box2);
      
      expect(intersection).not.toBeNull();
      expect(intersection!.x).toBe(50);
      expect(intersection!.y).toBe(50);
      expect(intersection!.width).toBe(50);
      expect(intersection!.height).toBe(50);
    });

    it('returns null for non-overlapping', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(200, 200, 100, 100);
      expect(box1.intersection(box2)).toBeNull();
    });
  });

  describe('union', () => {
    it('returns bounding box containing both', () => {
      const box1 = new BoundingBox(0, 0, 100, 100);
      const box2 = new BoundingBox(150, 150, 100, 100);
      const union = box1.union(box2);
      
      expect(union.x).toBe(0);
      expect(union.y).toBe(0);
      expect(union.width).toBe(250);
      expect(union.height).toBe(250);
    });
  });

  describe('expand', () => {
    it('expands box by padding', () => {
      const box = new BoundingBox(50, 50, 100, 100);
      const expanded = box.expand(10);
      
      expect(expanded.x).toBe(40);
      expect(expanded.y).toBe(40);
      expect(expanded.width).toBe(120);
      expect(expanded.height).toBe(120);
    });
  });

  describe('scale', () => {
    it('scales box by factor', () => {
      const box = new BoundingBox(10, 20, 100, 50);
      const scaled = box.scale(2);
      
      expect(scaled.x).toBe(20);
      expect(scaled.y).toBe(40);
      expect(scaled.width).toBe(200);
      expect(scaled.height).toBe(100);
    });
  });

  describe('equals', () => {
    it('returns true for identical boxes', () => {
      const box1 = new BoundingBox(10, 20, 100, 50);
      const box2 = new BoundingBox(10, 20, 100, 50);
      expect(box1.equals(box2)).toBe(true);
    });

    it('returns false for different boxes', () => {
      const box1 = new BoundingBox(10, 20, 100, 50);
      const box2 = new BoundingBox(11, 20, 100, 50);
      expect(box1.equals(box2)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('returns correct JSON', () => {
      const box = new BoundingBox(10, 20, 100, 50);
      const json = box.toJSON();
      
      expect(json).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    });
  });
});