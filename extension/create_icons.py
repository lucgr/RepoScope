from PIL import Image, ImageDraw
import os

def create_icon(size):
    # Create a new image with a transparent background
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Calculate dimensions based on size
    padding = size // 8
    inner_size = size - (2 * padding)
    
    # Draw the background (rounded rectangle)
    draw.rounded_rectangle(
        [(padding, padding), (size - padding, size - padding)],
        radius=size//10,
        fill='#2ecc71'
    )
    
    # Draw the triangles
    center_x = size // 2
    center_y = size // 2
    triangle_size = inner_size // 2
    
    # Left triangle
    draw.polygon([
        (center_x, center_y - triangle_size//2),
        (center_x - triangle_size//2, center_y + triangle_size//2),
        (center_x, center_y + triangle_size//2)
    ], fill='white')
    
    # Right triangle
    draw.polygon([
        (center_x, center_y - triangle_size//2),
        (center_x + triangle_size//2, center_y + triangle_size//2),
        (center_x, center_y + triangle_size//2)
    ], fill='white')
    
    # Bottom triangle
    draw.polygon([
        (center_x - triangle_size//2, center_y + triangle_size//2),
        (center_x + triangle_size//2, center_y + triangle_size//2),
        (center_x, center_y + triangle_size)
    ], fill='white')
    
    return image

# Define the sizes we need
sizes = [16, 48, 128]

# Create icons for each size
for size in sizes:
    icon = create_icon(size)
    output_path = f'icons/icon{size}.png'
    icon.save(output_path, 'PNG')
    print(f'Created {output_path}') 